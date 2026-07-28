// modules/insurance/services/insurance-policy.service.ts · policy ENROLMENT use-cases (KV-BL-052, screens
// 283-285). propose (→ 'proposed') | cancel (withdraw before premium payment). Every write: one ACID tx (UoW),
// state via the machine (Law 5), outbox in-tx (Law 4), idempotent mutation (Law 3), authz THROWS (Law 6).
// No version column on insurance_policies → the repo locks FOR UPDATE (mirrors loan_applications).
//
// BOUNDARY (stated per the founder's brief): premium PAYMENT rides the existing payments module — this
// service wires the `premiumPaymentId` SOCKET only (a nullable column set once DEV-23 collects payment) and
// never builds payment capture, never moves money, never calls wallet/payments here. Activation
// (proposed→active) is likewise DEV-23's job (KV-BL-053, strictly sequenced after this batch per
// 02_BACKEND_BACKLOG.md §E5's 051→052→053→054 chain) — this service does not call InsurancePolicy at any
// status other than 'proposed'→'cancelled'.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { QUOTA_SERVICE, QuotaService } from '../../../core/quota/quota.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { InsurancePolicy } from '../domain/insurance-policy.entity';
import { DomainEvent, SubjectType } from '../domain/insurance.events';
import { computeTotalPremiumMinor, splitPremium } from '../domain/premium-calc';
import { InsurancePolicyNotFoundError, InsuranceForbiddenError, InvalidSumInsuredError, PolicyNotAwaitingPremiumError } from '../domain/insurance.errors';
import { InsurancePolicyRepository } from '../repositories/insurance-policy.repository';
import { InsuranceProductService } from './insurance-product.service';
import { CreatePolicyEnrolmentDto } from '../dto/create-insurance-policy.dto';
import { PaymentService } from '../../payments/services/payment.service';

const QUOTA_METRIC = 'insurance_policies';
export interface InsuranceActor { userId: string; canManage: boolean; }
export interface ProposedPolicySummary { id: string; subjectId: string | null; sumInsuredMinor: string; premiumMinor: string; govtShareMinor: string; }

@Injectable()
export class InsurancePolicyService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(QUOTA_SERVICE) private readonly quota: QuotaService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: InsurancePolicyRepository,
    private readonly productSvc: InsuranceProductService,
    private readonly payments: PaymentService,
  ) {}

  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'insurance_policy', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }

  /** PROPOSE (enrol) — creates ONE insurance_policies row PER subject in `dto.subjects` (screen 284's
   *  multi-animal case), all inside ONE transaction under ONE idempotency key. `subjectType='person'`
   *  defaults an omitted subjectId to the caller's own userId (self — screen 285's single-holder scope; see
   *  DEV-22 STATE block schema-gap #2 for the family/nominee boundary, tracked against KV-BL-036). Premium is
   *  ALWAYS server-computed from the product's premium_calc + govt_subsidy_bps — the client's sumInsuredMinor
   *  is trusted (it depends on cross-module facts this schema doesn't carry) but the premium split never is. */
  async propose(tenantId: string, actor: InsuranceActor, idemKey: string, dto: CreatePolicyEnrolmentDto): Promise<{ policies: ProposedPolicySummary[] }> {
    return this.idem.remember(idemKey, actor.userId, 'insurance.policy.propose', () =>
      timed(this.metrics, 'insurance.policy.propose', { tenant: tenantId }, async () => {
        await this.quota.assertWithinLimit(tenantId, QUOTA_METRIC);
        const product = await this.productSvc.getActiveProductForEnrolment(tenantId, dto.productId);
        const calc = product.premiumCalc();

        return this.uow.run(tenantId, async (tx) => {
          const summaries: ProposedPolicySummary[] = [];
          for (const s of dto.subjects) {
            const sumInsuredMinor = BigInt(s.sumInsuredMinor);
            if (sumInsuredMinor <= 0n) throw new InvalidSumInsuredError();
            const totalPremiumMinor = computeTotalPremiumMinor(calc, sumInsuredMinor);
            const split = splitPremium(totalPremiumMinor, product.govtSubsidyBps);
            const subjectId = s.subjectId ?? (dto.subjectType === 'person' ? actor.userId : null);
            const id = uuidv7();
            const policy = InsurancePolicy.propose({
              id, tenantId, holderUserId: actor.userId, productId: product.id, policyNo: null,
              subjectType: dto.subjectType as SubjectType, subjectId,
              sumInsuredMinor, premiumMinor: split.farmerShareMinor, premiumPaymentId: null,
              validFrom: dto.validFrom, validUntil: dto.validUntil, parametricTriggers: null,
            });
            await this.repo.insert(tx, policy);
            await this.quota.increment(tx, tenantId, QUOTA_METRIC, 1);
            await this.flush(tx, tenantId, id, policy.pullEvents());
            summaries.push({ id, subjectId, sumInsuredMinor: sumInsuredMinor.toString(), premiumMinor: split.farmerShareMinor.toString(), govtShareMinor: split.govtShareMinor.toString() });
          }
          return { policies: summaries };
        }, { userId: actor.userId });
      }));
  }

  /** CANCEL — withdraw before premium is paid (or surrender an active policy; both routed through the same
   *  state-machine-guarded transition — screen 287's "Cancelled" example card). Owner-only (moderator bypass
   *  via canManage), idempotency-keyed so a retried tap never double-cancels/throws on an already-cancelled row. */
  async cancel(tenantId: string, actor: InsuranceActor, idemKey: string, id: string): Promise<{ id: string; status: string }> {
    return this.idem.remember(idemKey, actor.userId, 'insurance.policy.cancel', () =>
      timed(this.metrics, 'insurance.policy.cancel', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const policy = await this.repo.getForUpdate(tx, tenantId, id);
          if (policy.holderUserId !== actor.userId && !actor.canManage) throw new InsuranceForbiddenError('You can only cancel your own policy');
          policy.cancel();
          await this.repo.update(tx, policy);
          await this.flush(tx, tenantId, id, policy.pullEvents());
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'insurance.policy.cancelled', entityType: 'insurance_policy', entityId: id });
          return { id, status: policy.status };
        }, { userId: actor.userId })));
  }

  /** KV-BL-053 (Wave 3, screen 288) — initiate premium collection VIA the existing payments module. No
   *  capture/gateway/webhook logic lives here: this creates a `payments` intent (gateway order) whose
   *  eventual `payments.payment_succeeded` (referenceType='insurance_policy') the module's own outbox
   *  handler (PremiumPaymentSucceededHandler) consumes to fire `InsurancePolicy.activate()`. Ownership +
   *  status are validated HERE, BEFORE calling into payments — the payments module's own
   *  `assertValidReference` only special-cases `referenceType==='order'` (see payment.service.ts), so this
   *  module must be its own gatekeeper for `insurance_policy`, exactly the discipline `orders`' own
   *  `OrderPaymentService` documents for its wallet-debit path. The amount sent to the gateway is the
   *  policy's OWN server-computed `premiumMinor` (never client-supplied) — money never queues, never
   *  silently activates (Law 6/2). */
  async initiatePremiumPayment(tenantId: string, actor: InsuranceActor, idemKey: string, policyId: string) {
    return this.idem.remember(idemKey, actor.userId, 'insurance.policy.initiate_premium_payment', () =>
      timed(this.metrics, 'insurance.policy.initiate_premium_payment', { tenant: tenantId }, async () => {
        const policy = await this.repo.getById(tenantId, policyId);
        if (!policy) throw new InsurancePolicyNotFoundError(policyId); // 404, no IDOR
        if (policy.holderUserId !== actor.userId && !actor.canManage) throw new InsurancePolicyNotFoundError(policyId);
        if (policy.status !== 'proposed') throw new PolicyNotAwaitingPremiumError(policy.status);
        const intent = await this.payments.createIntent(tenantId, actor.userId, `insprem:${idemKey}`, {
          purpose: 'insurance_premium', amountMinor: policy.premiumMinor.toString(), currencyCode: 'INR',
          referenceType: 'insurance_policy', referenceId: policy.id,
        });
        return { policyId: policy.id, ...intent };
      }));
  }

  async getById(tenantId: string, actor: InsuranceActor, id: string) {
    const p = await this.repo.getById(tenantId, id);
    if (!p) throw new InsurancePolicyNotFoundError(id);
    if (p.holderUserId !== actor.userId && !actor.canManage) throw new InsurancePolicyNotFoundError(id); // 404, no IDOR
    return p.toJSON();
  }

  /** "My policies" (screen 287) — keyset-paginated, holder-scoped unless the caller can manage. */
  async list(tenantId: string, actor: InsuranceActor, q: { status?: string; cursor?: { c: string; id: string }; limit: number }) {
    const rows = await this.repo.listFor(tenantId, {
      holderUserId: actor.canManage ? undefined : actor.userId,
      status: q.status as any, cursor: q.cursor, limit: q.limit,
    });
    const items = rows.map((p) => p.toJSON());
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${(last as any).createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }
}
