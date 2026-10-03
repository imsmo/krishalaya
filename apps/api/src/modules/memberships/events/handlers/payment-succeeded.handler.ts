// modules/memberships/events/handlers/payment-succeeded.handler.ts
// Consumes payments.payment_succeeded (delivered by the outbox relay). Acts ONLY on payments whose
// referenceType is 'membership' — i.e. a subscription paid via the GATEWAY/card path (referenceId =
// membershipId), as opposed to the synchronous wallet-debit path in UserMembershipService.subscribe.
// On success it stamps the payment reference onto the membership and ensures it is live (the card-payment
// ACTIVATION path the module README flagged). Touches ONLY memberships' own table (Law 11), inside the
// relay's per-event tx. IDEMPOTENT: confirmPayment is a no-op once a paymentId is set (or the membership
// is already dead), so a relay re-delivery — or a subscription already activated by the wallet path —
// changes nothing and emits no event.
//
// PC-56 HOTFIX-2 — the relay runs handlers as `kv_relay`, which holds NO privilege on `user_memberships`: every gateway-paid
// membership died 42501 at the lock and its event was quarantined (with every sibling handler of payment_succeeded). The lock,
// the update and the `membership.payment_confirmed` outbox row now run in ONE request-tier unit of work (kv_app, RLS-bound to
// the event's tenant — the role that holds exactly these grants), so the row and its event still commit together. The relay tx
// is not used. No grant was added to kv_relay; idempotency is unchanged (a retry finds paymentId set and does nothing).
import { Inject, Injectable } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { OUTBOX_WRITER, OutboxWriter } from '../../../../core/outbox/outbox.writer';
import { TxContext, UNIT_OF_WORK, UnitOfWork } from '../../../../core/database/unit-of-work';
import { UserMembershipRepository } from '../../repositories/user-membership.repository';

@Injectable()
export class MembershipPaymentSucceededHandler implements OutboxHandler {
  readonly eventType = 'payments.payment_succeeded';
  constructor(
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    private readonly memberships: UserMembershipRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async handle(event: OutboxEvent, _relayTx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const p = event.payload as Record<string, unknown>;
    if (!tenantId || p.referenceType !== 'membership') return;        // only a subscription gateway settlement
    const membershipId = typeof p.referenceId === 'string' ? p.referenceId : undefined;
    if (!membershipId) return;
    // the payment reference travels as the payload's paymentId, else the payment aggregate id (defence-in-depth)
    const paymentId = (typeof p.paymentId === 'string' && p.paymentId) ? p.paymentId : event.aggregateId;
    if (!paymentId) return;

    await this.uow.run(tenantId, async (tx) => {
      const membership = await this.memberships.getForUpdate(tx, tenantId, membershipId);
      if (!membership) return;                                        // not a membership we own (other tenant / unrelated payment)
      if (!membership.confirmPayment(paymentId)) return;              // already confirmed / dead → idempotent no-op
      await this.memberships.update(tx, membership);
      for (const e of membership.pullEvents()) {
        await this.outbox.write(tx, { tenantId, aggregateType: 'user_membership', aggregateId: membership.id, eventType: e.type, payload: { v: 1, ...e.payload } });
      }
    }, { userId: 'system' });
  }
}
