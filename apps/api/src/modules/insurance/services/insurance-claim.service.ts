// modules/insurance/services/insurance-claim.service.ts · claims lifecycle use-cases (KV-BL-054, screens
// 289-293, W255-264 canon reference for the insurer-side shape only). File -> evidence -> (docs) -> survey
// -> decision -> settle -> close. Every write: one ACID tx (UoW), state via the machine (Law 5), outbox
// in-tx (Law 4), idempotent money mutations (Law 3), authz THROWS (Law 6). No version column on
// insurance_claims -> the repo locks FOR UPDATE (mirrors insurance_policies).
//
// MONEY-PATH BOUNDARY (settle(), see spec_dev23.md for the full statement): settlement credits the
// claimant's OWN wallet directly via the already-exported WALLET_SERVICE port (the SAME primitive
// ambassador-earning.service.ts uses to pay a third party from a platform account) -- NOT a new money
// primitive. `insurance_claims.payout_id` is left NULL: the payments module exposes no "system-initiated
// third-party payout" hook this batch can call without inventing new payments-module money-movement code
// (PayoutService.requestPayout is self-serve-only, debits the CALLER's own wallet first -- architecturally
// the wrong direction for money the insurer owes the claimant). Recorded for founder arbitration, not
// invented around.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { QUOTA_SERVICE, QuotaService } from '../../../core/quota/quota.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { WALLET_SERVICE, WalletPort } from '../../../core/wallet/wallet.port';
import { userMain, platform, PlatformAccount } from '../../../core/wallet/account-codes';
import { uuidv7 } from '../../../core/database/uuid.util';
import { InsuranceClaim } from '../domain/insurance-claim.entity';
import { DomainEvent, ClaimEventType } from '../domain/insurance.events';
import { isOnCover } from '../domain/insurance-policy.state';
import {
  InsuranceClaimNotFoundError, InsuranceForbiddenError, PolicyNotOnCoverError, InvalidClaimEventTypeError,
  InvalidClaimDecisionError, ClaimNotAwaitingAcknowledgementError, ClaimEvidenceNotAttachableError,
  InsurancePolicyNotFoundError, VetCertNotApplicableError,
} from '../domain/insurance.errors';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { VET_CERT_PROVIDER, VetCertProvider } from '../gateway/vet-cert-provider.port';
import { InsuranceClaimRepository } from '../repositories/insurance-claim.repository';
import { InsurancePolicyRepository } from '../repositories/insurance-policy.repository';
import { InsuranceActor } from './insurance-policy.service';
import { CreateInsuranceClaimDto, AddClaimEvidenceDto, AcknowledgeAssessmentDto } from '../dto/create-insurance-claim.dto';
import { ScheduleSurveyDto, RecordSurveyDto, DecideClaimDto } from '../dto/insurance-claim-actions.dto';
import { VerifyVetCertDto } from '../dto/verify-vet-cert.dto';

const QUOTA_METRIC = 'insurance_claims';

@Injectable()
export class InsuranceClaimService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(QUOTA_SERVICE) private readonly quota: QuotaService,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    @Inject(VET_CERT_PROVIDER) private readonly vetCert: VetCertProvider,
    private readonly flags: FlagsService,
    private readonly audit: AuditWriter,
    private readonly repo: InsuranceClaimRepository,
    private readonly policies: InsurancePolicyRepository,
  ) {}

  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'insurance_claim', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }

  /** FILE (screens 289-290). One claim per call, ONE tx, idempotency-keyed. The policy must be ON COVER
   *  (isOnCover — only 'active'); a proposed/cancelled/lapsed/expired/already-claimed policy cannot be
   *  claimed against (screen 289's policy picker only ever lists active policies). */
  async file(tenantId: string, actor: InsuranceActor, idemKey: string, dto: CreateInsuranceClaimDto) {
    return this.idem.remember(idemKey, actor.userId, 'insurance.claim.file', () =>
      timed(this.metrics, 'insurance.claim.file', { tenant: tenantId }, async () => {
        await this.quota.assertWithinLimit(tenantId, QUOTA_METRIC);
        const policy = await this.policies.getById(tenantId, dto.policyId);
        if (!policy) throw new InsurancePolicyNotFoundError(dto.policyId);
        if (policy.holderUserId !== actor.userId && !actor.canManage) throw new InsurancePolicyNotFoundError(dto.policyId); // 404, no IDOR
        if (!isOnCover(policy.status)) throw new PolicyNotOnCoverError(policy.id, policy.status);

        return this.uow.run(tenantId, async (tx) => {
          const eventTypeId = await this.repo.resolveEventTypeId(tx, dto.eventTypeCode);
          if (!eventTypeId) throw new InvalidClaimEventTypeError(dto.eventTypeCode);
          const id = uuidv7();
          const claim = InsuranceClaim.file({
            id, tenantId, policyId: policy.id, claimantUserId: actor.userId,
            eventDate: dto.eventDate, eventTypeId, description: dto.description ?? null,
          });
          await this.repo.insert(tx, claim);
          await this.quota.increment(tx, tenantId, QUOTA_METRIC, 1);
          if (dto.evidenceMediaIds?.length) {
            for (const mediaId of dto.evidenceMediaIds) {
              if (!(await this.repo.evidenceAttachable(tx, tenantId, mediaId, actor.userId))) throw new ClaimEvidenceNotAttachableError(mediaId);
            }
            await this.repo.attachEvidence(tx, id, dto.evidenceMediaIds);
          }
          await this.flush(tx, tenantId, id, claim.pullEvents());
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'insurance.claim.filed', entityType: 'insurance_claim', entityId: id, newValue: { policyId: policy.id }, ip: null });
          return claim.toJSON();
        }, { userId: actor.userId });
      }));
  }

  /** ADD EVIDENCE (screen 290's "add more anytime before survey"). Owner-only, and only before a survey
   *  visit is scheduled (intimated | docs_pending). */
  async addEvidence(tenantId: string, actor: InsuranceActor, claimId: string, dto: AddClaimEvidenceDto) {
    return this.uow.run(tenantId, async (tx) => {
      const claim = await this.repo.getForUpdate(tx, tenantId, claimId);
      if (claim.claimantUserId !== actor.userId && !actor.canManage) throw new InsuranceForbiddenError('You can only add evidence to your own claim');
      if (claim.status !== 'intimated' && claim.status !== 'docs_pending') throw new InvalidClaimDecisionError('Evidence can only be added before a survey is scheduled');
      for (const mediaId of dto.mediaIds) {
        if (!(await this.repo.evidenceAttachable(tx, tenantId, mediaId, actor.userId))) throw new ClaimEvidenceNotAttachableError(mediaId);
      }
      await this.repo.attachEvidence(tx, claimId, dto.mediaIds);
      await this.outbox.write(tx, { tenantId, aggregateType: 'insurance_claim', aggregateId: claimId, eventType: ClaimEventType.EvidenceAdded, payload: { v: 1, claimId, mediaIds: dto.mediaIds } });
      return { id: claimId, added: dto.mediaIds.length };
    }, { userId: actor.userId });
  }

  /** screen 292's "I agree / I disagree". Agree records no state change (the insurer's decide() is
   *  separate); disagree re-opens a re-survey ("never cancels your claim"). Owner-only. */
  async acknowledgeAssessment(tenantId: string, actor: InsuranceActor, claimId: string, dto: AcknowledgeAssessmentDto) {
    return this.uow.run(tenantId, async (tx) => {
      const claim = await this.repo.getForUpdate(tx, tenantId, claimId);
      if (claim.claimantUserId !== actor.userId && !actor.canManage) throw new InsuranceForbiddenError('You can only acknowledge your own claim');
      if (claim.status !== 'surveyed') throw new ClaimNotAwaitingAcknowledgementError(claim.status);
      if (!dto.agree) {
        claim.requestResurvey();
        await this.repo.update(tx, claim);
        await this.flush(tx, tenantId, claimId, claim.pullEvents());
      }
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'insurance.claim.assessment_acknowledged', entityType: 'insurance_claim', entityId: claimId, newValue: { agree: dto.agree }, ip: null });
      return { id: claimId, status: claim.status, agree: dto.agree };
    }, { userId: actor.userId });
  }

  // ---- insurer-side (insurance.manage), mirrors the lender-partner RBAC pattern -------------------------

  async requestDocuments(tenantId: string, actor: InsuranceActor, claimId: string) {
    if (!actor.canManage) throw new InsuranceForbiddenError('requires insurance.manage');
    return this.mutate(tenantId, actor, claimId, (c) => c.requestDocuments(), 'insurance.claim.documents_requested', {});
  }

  /** VET-CERT VERIFICATION (DEV-25/KV-BL-057, Wave 7 external integration #3) — ADVISORY ONLY: this NEVER
   *  auto-transitions the claim's status (Law 12: a livestock claim settlement decision is always made by
   *  the insurer via decide(), never automated on a provider signal). Only applicable to a livestock claim
   *  (the underlying policy's subjectType==='animal'). Flag-gated (`vet_cert_verification`, default OFF, §8) —
   *  OFF -> returns an honest 'unavailable' WITHOUT calling the external provider at all (no named vet-cert
   *  verification provider is contracted in this environment). Result is recorded via audit only (no column
   *  on insurance_claims anticipates a persisted vet-cert verification status — disclosed, not invented). */
  async verifyVetCert(tenantId: string, actor: InsuranceActor, claimId: string, dto: VerifyVetCertDto) {
    if (!actor.canManage) throw new InsuranceForbiddenError('requires insurance.manage');
    const claim = await this.repo.getById(tenantId, claimId);
    if (!claim) throw new InsuranceClaimNotFoundError(claimId);
    const claimProps = claim.toJSON();
    const policy = await this.policies.getById(tenantId, claimProps.policyId);
    if (!policy || policy.toJSON().subjectType !== 'animal') throw new VetCertNotApplicableError(claimId);

    const enabled = await this.flags.isEnabled('vet_cert_verification', { tenantId });
    const result = enabled
      ? await this.vetCert.verify({ idempotencyKey: `${claimId}:${dto.certRef}`, tenantId, claimId, certRef: dto.certRef })
      : { status: 'unavailable' as const, failureReason: 'vet_cert_verification_disabled' };

    return this.uow.run(tenantId, async (tx) => {
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId, action: 'insurance.claim.vet_cert_verify_attempted',
        entityType: 'insurance_claim', entityId: claimId,
        newValue: { certRef: dto.certRef, status: result.status, providerRef: (result as any).providerRef ?? null, failureReason: result.failureReason ?? null },
        ip: null,
      });
      return {
        claimId, certRef: dto.certRef, status: result.status,
        providerRef: (result as any).providerRef ?? null, failureReason: result.failureReason ?? null,
        manualReviewRequired: result.status !== 'verified',   // never auto-verified — insurer still decides via decide()
      };
    }, { userId: actor.userId });
  }

  async scheduleSurvey(tenantId: string, actor: InsuranceActor, claimId: string, dto: ScheduleSurveyDto) {
    if (!actor.canManage) throw new InsuranceForbiddenError('requires insurance.manage');
    return this.mutate(tenantId, actor, claimId, (c) => c.scheduleSurvey(dto.surveyorUserId), 'insurance.claim.survey_scheduled', { surveyorUserId: dto.surveyorUserId });
  }

  async recordSurvey(tenantId: string, actor: InsuranceActor, claimId: string, dto: RecordSurveyDto) {
    if (!actor.canManage) throw new InsuranceForbiddenError('requires insurance.manage');
    const report = { damagePercent: dto.damagePercent, notes: dto.notes ?? null, surveyedAt: dto.surveyedAt ?? new Date().toISOString() };
    return this.mutate(tenantId, actor, claimId, (c) => c.recordSurvey(report), 'insurance.claim.surveyed', report);
  }

  /** DECIDE (screen 293's settlement math source). approvedMinor is capped at the POLICY's sum insured --
   *  a cross-aggregate check this service performs (the entity does not know the policy's sum insured). */
  async decide(tenantId: string, actor: InsuranceActor, claimId: string, dto: DecideClaimDto) {
    if (!actor.canManage) throw new InsuranceForbiddenError('requires insurance.manage');
    return this.uow.run(tenantId, async (tx) => {
      const claim = await this.repo.getForUpdate(tx, tenantId, claimId);
      let approvedMinor: bigint | null = null;
      if (dto.decision !== 'rejected') {
        if (!dto.approvedMinor) throw new InvalidClaimDecisionError('approvedMinor is required for an approved/partially_approved decision');
        approvedMinor = BigInt(dto.approvedMinor);
        const policy = await this.policies.getById(tenantId, claim.policyId);
        if (!policy) throw new InsurancePolicyNotFoundError(claim.policyId);
        const sumInsuredMinor = policy.toProps().sumInsuredMinor;
        if (approvedMinor > sumInsuredMinor) throw new InvalidClaimDecisionError(`approvedMinor (${approvedMinor}) cannot exceed the policy's sum insured (${sumInsuredMinor})`);
      } else if (dto.approvedMinor) {
        throw new InvalidClaimDecisionError('approvedMinor must be absent for a rejected decision');
      }
      claim.decide(dto.decision, approvedMinor, dto.note ?? null);
      await this.repo.update(tx, claim);
      await this.flush(tx, tenantId, claimId, claim.pullEvents());
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'insurance.claim.decided', entityType: 'insurance_claim', entityId: claimId, newValue: { decision: dto.decision, approvedMinor: dto.approvedMinor ?? null, note: dto.note ?? null }, ip: null });
      return claim.toJSON();
    }, { userId: actor.userId });
  }

  /** SETTLE — money-out (screen 293). Idempotency-keyed (Law 3): the wallet credit is ALSO idempotent on
   *  its own key (`insurance-claim-settle:<claimId>`), double safety against a double-credit even if the
   *  outer idem wrapper is somehow bypassed. Also fires the underlying policy's active->claimed transition
   *  in the SAME tx (both aggregates live in this module — no cross-module boundary crossed). */
  async settle(tenantId: string, actor: InsuranceActor, idemKey: string, claimId: string) {
    if (!actor.canManage) throw new InsuranceForbiddenError('requires insurance.manage');
    return this.idem.remember(idemKey, actor.userId, 'insurance.claim.settle', () =>
      timed(this.metrics, 'insurance.claim.settle', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const claim = await this.repo.getForUpdate(tx, tenantId, claimId);
          claim.settle();   // throws ClaimNotApprovedError if not approved/partially_approved
          const approvedMinor = claim.approvedMinor as bigint;

          const txn = await this.wallet.post(tx, {
            tenantId, txnType: 'insurance_claim_settlement', idempotencyKey: `insurance-claim-settle:${claimId}`,
            referenceType: 'insurance_claim', referenceId: claimId, initiatedBy: actor.userId,
            legs: [
              { account: platform(PlatformAccount.Payouts), amountMinor: -approvedMinor },
              { account: userMain(claim.claimantUserId), amountMinor: approvedMinor },
            ],
          });

          const policy = await this.policies.getForUpdate(tx, tenantId, claim.policyId);
          policy.markClaimed();
          await this.policies.update(tx, policy);
          await this.flush(tx, tenantId, policy.id, policy.pullEvents());

          await this.repo.update(tx, claim);
          await this.flush(tx, tenantId, claimId, claim.pullEvents());
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'insurance.claim.settled', entityType: 'insurance_claim', entityId: claimId, newValue: { approvedMinor: approvedMinor.toString(), ledgerTxnId: txn.txnId }, ip: null });
          return { id: claimId, status: claim.status, approvedMinor: approvedMinor.toString(), ledgerTxnId: txn.txnId };
        }, { userId: actor.userId })));
  }

  async close(tenantId: string, actor: InsuranceActor, claimId: string) {
    if (!actor.canManage) throw new InsuranceForbiddenError('requires insurance.manage');
    return this.mutate(tenantId, actor, claimId, (c) => c.close(), 'insurance.claim.closed', {});
  }

  async getById(tenantId: string, actor: InsuranceActor, id: string) {
    const c = await this.repo.getById(tenantId, id);
    if (!c) throw new InsuranceClaimNotFoundError(id);
    if (c.claimantUserId !== actor.userId && !actor.canManage) throw new InsuranceClaimNotFoundError(id); // 404, no IDOR
    return c.toJSON();
  }

  /** "My claims" (claimant-scoped) or the insurer queue (all, insurance.manage). */
  async list(tenantId: string, actor: InsuranceActor, q: { status?: string; policyId?: string; cursor?: { c: string; id: string }; limit: number }) {
    const rows = await this.repo.listFor(tenantId, {
      claimantUserId: actor.canManage ? undefined : actor.userId,
      policyId: q.policyId, status: q.status as any, cursor: q.cursor, limit: q.limit,
    });
    const items = rows.map((c) => c.toJSON());
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${(last as any).createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }

  private async mutate(tenantId: string, actor: InsuranceActor, claimId: string, fn: (c: InsuranceClaim) => void, action: string, auditValue: Record<string, unknown>) {
    return this.uow.run(tenantId, async (tx) => {
      const claim = await this.repo.getForUpdate(tx, tenantId, claimId);
      fn(claim);
      await this.repo.update(tx, claim);
      await this.flush(tx, tenantId, claimId, claim.pullEvents());
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action, entityType: 'insurance_claim', entityId: claimId, newValue: auditValue, ip: null });
      return claim.toJSON();
    }, { userId: actor.userId });
  }
}
