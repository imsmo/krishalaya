// modules/insurance/events/handlers/premium-payment-succeeded.handler.ts
// Consumes payments.payment_succeeded (delivered by the outbox relay). Acts ONLY on payments whose
// referenceType is 'insurance_policy' (i.e. a premium payment initiated via
// InsurancePolicyService.initiatePremiumPayment). Structurally mirrors
// modules/memberships/events/handlers/payment-succeeded.handler.ts (the closest existing precedent for
// "a gateway payment activates a subscription-shaped aggregate") and
// modules/orders/events/handlers/payment-succeeded.handler.ts byte-for-byte in shape.
//
// TRUST-CRITICAL ASSERTION (KV-BL-053): a policy NEVER goes proposed->active without a payment this
// handler itself re-verified matches the policy's OWN premiumMinor. The payments module's own
// assertValidReference only special-cases referenceType==='order' (see payment.service.ts's own
// documented boundary) -- for 'insurance_policy' it does not re-check amount/ownership at capture time, so
// this handler is the LAST line of defence: a mismatched amount throws (-> outbox DLQ, never a silent
// wrong-amount activation), never just logs and proceeds. IDEMPOTENT: InsurancePolicy.activate() is a
// no-op (returns false) once already active/terminal, so a relay re-delivery changes nothing and emits
// nothing further.
//
// PC-56 HOTFIX-2 — the relay runs handlers as `kv_relay`, which holds only SELECT on `insurance_policies`: the policy lock
// (SELECT … FOR UPDATE needs UPDATE) died 42501 — and the `.catch(() => null)` below swallowed it, so the handler returned as if the
// policy were not ours while the relay transaction was already aborted; the next statement failed 25P02 and the event was
// quarantined with no trace of the real cause. The lock, the activation, its outbox rows and the audit row now run in ONE
// request-tier unit of work (kv_app, RLS-bound to the event's tenant — the role that holds these grants); the relay tx is not used.
// The amount-mismatch refusal still throws (→ the event fails and is retried, never a silent wrong-amount activation). No grant
// was added to kv_relay.
import { Inject, Injectable } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { OUTBOX_WRITER, OutboxWriter } from '../../../../core/outbox/outbox.writer';
import { TxContext, UNIT_OF_WORK, UnitOfWork } from '../../../../core/database/unit-of-work';
import { AuditWriter } from '../../../../core/audit/audit.writer';
import { InsurancePolicyRepository } from '../../repositories/insurance-policy.repository';
import { InsurancePremiumAmountMismatchError } from '../../domain/insurance.errors';

@Injectable()
export class PremiumPaymentSucceededHandler implements OutboxHandler {
  readonly eventType = 'payments.payment_succeeded';
  constructor(
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    private readonly repo: InsurancePolicyRepository,
    private readonly audit: AuditWriter,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async handle(event: OutboxEvent, _relayTx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const p = event.payload as Record<string, unknown>;
    if (!tenantId || p.referenceType !== 'insurance_policy') return;   // not a premium-payment settlement
    const policyId = typeof p.referenceId === 'string' ? p.referenceId : undefined;
    if (!policyId) return;
    const paymentId = (typeof p.paymentId === 'string' && p.paymentId) ? p.paymentId : event.aggregateId;
    if (!paymentId) return;

    await this.uow.run(tenantId, async (tx) => {
      const policy = await this.repo.getForUpdate(tx, tenantId, policyId).catch(() => null);
      if (!policy) return;                                              // not ours / already gone
      if (policy.status !== 'proposed') return;                         // idempotent no-op (already active/terminal)

      const capturedMinor = typeof p.amountMinor === 'string' ? BigInt(p.amountMinor) : undefined;
      if (capturedMinor !== undefined && capturedMinor !== policy.premiumMinor) {
        // Money-safety tamper guard (Law 2/12): never activate on a wrong amount -> DLQ, not swallowed.
        throw new InsurancePremiumAmountMismatchError(policy.premiumMinor, capturedMinor);
      }

      const changed = policy.activate(paymentId);
      if (!changed) return;
      await this.repo.update(tx, policy);
      for (const e of policy.pullEvents()) {
        await this.outbox.write(tx, { tenantId, aggregateType: 'insurance_policy', aggregateId: policy.id, eventType: e.type, payload: { v: 1, ...e.payload } });
      }
      await this.audit.write(tx, { tenantId, actorUserId: 'system', action: 'insurance.policy.activated', entityType: 'insurance_policy', entityId: policy.id, newValue: { paymentId }, ip: null });
    }, { userId: 'system' });
  }
}
