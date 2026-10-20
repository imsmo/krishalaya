// modules/insurance/services/insurance-claim.service.ts · claims lifecycle use-cases (KV-BL-054, screens
// 289-293, W255-264 canon reference for the insurer-side shape only). File -> evidence -> (docs) -> survey
// -> decision -> close (settle REFUSED, PARTNER-3a). Every write: one ACID tx (UoW), state via the machine (Law 5), outbox
// in-tx (Law 4), idempotent money mutations (Law 3), authz THROWS (Law 6). No version column on
// insurance_claims -> the repo locks FOR UPDATE (mirrors insurance_policies).
//
// PC-56 PARTNER-3a (survey F-1 / F-2 / F-7; founder Q1 / Q2 / Q3 / Q5, 2026-10-18) — THE TENANT REALM MOVES NO CLAIM MONEY:
//   • settle() is REFUSED BY NAME (INSURANCE_SETTLEMENT_NOT_ON_PLATFORM, 403) before anything is read. The old posting —
//     platform(Payouts) → userMain(claimant), the policy flipped active → claimed in the same tx — is REMOVED from this service (not
//     merely unreachable): the platform's payouts clearing account was paying claims nobody funded (survey §1 rupee 1–3). Settlement
//     returns with the insurer's funding leg as one founder-signed money wave (P2-B11 + P3-B5). The route stays so a caller gets the
//     sentence; the entity's `settle()` transition stays in the state machine and no service calls it.
//   • file() records the POLICY HOLDER as the claimant, never the filer. A desk member (`insurance.manage`) may file on another member's
//     policy only ON BEHALF OF the holder: the filer is `created_by` on the row and the audit row's actor, with `assisted: true`. A death
//     claim on a person's own cover (subject = holder) is refused by name until a nominee model exists (INSURANCE_CLAIM_NEEDS_NOMINEE).
//   • decide() refuses a decider who filed the claim (`created_by`), is its claimant, or is its surveyor (INSURANCE_DECIDER_CONFLICT, 409).
//     The FPO desk still decides (founder Q3: the insurer only READS in this wave).
//   • scheduleSurvey() refuses a surveyor who is not an ACTIVE member of the claim's organisation (a live `user_tenant_roles` grant, not
//     under a live `tenant_member_suspensions` row) or who is the claimant (INSURANCE_SURVEYOR_INVALID, 422).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { QUOTA_SERVICE, QuotaService } from '../../../core/quota/quota.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { InsuranceClaim } from '../domain/insurance-claim.entity';
import { DomainEvent, ClaimEventType } from '../domain/insurance.events';
import { isOnCover } from '../domain/insurance-policy.state';
import {
  InsuranceClaimNotFoundError, InsuranceForbiddenError, PolicyNotOnCoverError, InvalidClaimEventTypeError,
  InvalidClaimDecisionError, ClaimNotAwaitingAcknowledgementError, ClaimEvidenceNotAttachableError,
  InsurancePolicyNotFoundError, VetCertNotApplicableError, InsuranceSettlementNotOnPlatformError, InsuranceClaimNeedsNomineeError,
  InsuranceDeciderConflictError, InsuranceSurveyorInvalidError,
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
        const holder = policy.toProps();
        // founder Q2: the claimant is ALWAYS the holder; anyone else filing is an assisted filing, allowed to a desk member only
        const assisted = holder.holderUserId !== actor.userId;
        if (assisted && !actor.canManage) throw new InsurancePolicyNotFoundError(dto.policyId); // 404, no IDOR
        if (!isOnCover(policy.status)) throw new PolicyNotOnCoverError(policy.id, policy.status);
        if (needsNominee(holder, dto.eventTypeCode)) throw new InsuranceClaimNeedsNomineeError(policy.id);

        return this.uow.run(tenantId, async (tx) => {
          const eventTypeId = await this.repo.resolveEventTypeId(tx, dto.eventTypeCode);
          if (!eventTypeId) throw new InvalidClaimEventTypeError(dto.eventTypeCode);
          const id = uuidv7();
          const claim = InsuranceClaim.file({
            id, tenantId, policyId: policy.id, claimantUserId: holder.holderUserId,
            eventDate: dto.eventDate, eventTypeId, eventTypeCode: dto.eventTypeCode, description: dto.description ?? null,
          });
          await this.repo.insert(tx, claim, actor.userId);   // created_by = the FILER (the decider-conflict check reads it)
          await this.quota.increment(tx, tenantId, QUOTA_METRIC, 1);
          if (dto.evidenceMediaIds?.length) {
            for (const mediaId of dto.evidenceMediaIds) {
              if (!(await this.repo.evidenceAttachable(tx, tenantId, mediaId, actor.userId))) throw new ClaimEvidenceNotAttachableError(mediaId);
            }
            await this.repo.attachEvidence(tx, id, dto.evidenceMediaIds);
          }
          await this.flush(tx, tenantId, id, claim.pullEvents());
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'insurance.claim.filed', entityType: 'insurance_claim', entityId: id, newValue: { policyId: policy.id, assisted }, ip: null });
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

  // ---- the FPO's insurance desk (insurance.manage — tenant staff, NOT an insurer: survey C-3 / C-4) ---------

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
    return this.mutate(tenantId, actor, claimId, (c) => c.scheduleSurvey(dto.surveyorUserId), 'insurance.claim.survey_scheduled', { surveyorUserId: dto.surveyorUserId },
      async (tx, c) => {
        // founder Q5: never the claimant; an ACTIVE member of the claim's organisation (user_tenant_roles + no live suspension)
        if (dto.surveyorUserId === c.claimantUserId) throw new InsuranceSurveyorInvalidError(claimId, 'claimant');
        if (!(await this.repo.isActiveMember(tx, tenantId, dto.surveyorUserId))) throw new InsuranceSurveyorInvalidError(claimId, 'not_member');
      });
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
      // founder Q2: the decider is never the filer (`created_by`), the claimant or the claim's surveyor
      const conflict = decisionConflict(actor.userId, { filer: await this.repo.filerOf(tx, tenantId, claimId), claimant: claim.claimantUserId, surveyor: claim.toProps().surveyorUserId });
      if (conflict) throw new InsuranceDeciderConflictError(claimId, conflict);
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

  /** SETTLE — REFUSED FROM THE TENANT REALM BY NAME (founder Q1, PC-56 PARTNER-3a). Thrown before any read, any idempotency record, any
   *  ledger call: no posting exists in this service any more. The claim stays approved; the policy stays active. */
  async settle(_tenantId: string, _actor: InsuranceActor, _claimId: string): Promise<never> {
    throw new InsuranceSettlementNotOnPlatformError();
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

  private async mutate(tenantId: string, actor: InsuranceActor, claimId: string, fn: (c: InsuranceClaim) => void, action: string, auditValue: Record<string, unknown>,
    pre?: (tx: TxContext, c: InsuranceClaim) => Promise<void>) {
    return this.uow.run(tenantId, async (tx) => {
      const claim = await this.repo.getForUpdate(tx, tenantId, claimId);
      if (pre) await pre(tx, claim);
      fn(claim);
      await this.repo.update(tx, claim);
      await this.flush(tx, tenantId, claimId, claim.pullEvents());
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action, entityType: 'insurance_claim', entityId: claimId, newValue: auditValue, ip: null });
      return claim.toJSON();
    }, { userId: actor.userId });
  }
}

/** Founder Q2 — a death claim on a person's OWN cover (a `person` policy whose subject is its holder, or names no subject: enrolment defaults
 *  an omitted person subject to the holder) has nobody to receive it until a nominee model exists. Any other claim on a person policy (an
 *  accident the holder survived) is the holder's own and is filed as usual. */
export function needsNominee(policy: { subjectType: string; subjectId: string | null; holderUserId: string }, eventTypeCode: string): boolean {
  return policy.subjectType === 'person' && (policy.subjectId === null || policy.subjectId === policy.holderUserId) && eventTypeCode === 'death';
}

/** Founder Q2 — who may NOT decide a claim: its filer (`created_by`), its claimant, its surveyor. Null = no conflict. */
export function decisionConflict(deciderUserId: string, c: { filer: string | null; claimant: string; surveyor: string | null }): 'filer' | 'claimant' | 'surveyor' | null {
  if (c.filer && c.filer === deciderUserId) return 'filer';
  if (c.claimant === deciderUserId) return 'claimant';
  if (c.surveyor && c.surveyor === deciderUserId) return 'surveyor';
  return null;
}
