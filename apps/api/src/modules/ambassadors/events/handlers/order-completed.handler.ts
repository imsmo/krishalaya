// modules/ambassadors/events/handlers/order-completed.handler.ts · consumes orders.order_completed.
// If the SELLER (a farmer) was referred by an ambassador, accrue a sale commission ('first_sale_facilitated': rate_bps of
// the GOODS SUBTOTAL, capped, at most `max_sales_per_farmer` times per farmer) to that ambassador. IDEMPOTENT (the earning
// is keyed on the order id via existsFor). Money-free here — payout is a separate, recorded human act.
//
// PC-56 TENANT-10a
//   • F-5 — THE BASE IS THE GOODS, NOT THE ORDER TOTAL. `totalMinor` includes delivery and the buyer's platform fee; the
//     commission was being paid on both. The base is now `subtotal_minor` — from the event when it carries one, else from
//     the order row itself. The plan's conditions are evaluated in `accrue` (cap per farmer; the referral's window).
//   • F-27 (found on the way, P0) — THIS HANDLER COULD NOT RUN WHERE IT RUNS. The relay executes handlers on its own
//     connection as `kv_relay`, which holds NO privilege on `ambassador_profiles` or `commission_plans_ambassador` and only
//     SELECT on `ambassador_earnings` (0078/0080; the DEV-54 spec pins that kv_relay must never write earnings). So for a
//     referred seller the handler threw `permission denied` — and because every handler of an event shares the relay's
//     transaction, the SELLER'S SETTLEMENT rolled back with it and the event was quarantined. The accrual now runs in its
//     own request-tier unit of work (kv_app, RLS-bound to the event's tenant — the role that holds exactly these grants).
//     It is still idempotent per order, so a relay retry after a later handler's failure accrues nothing twice; and an
//     accrual failure still fails the event (it is retried), it is never swallowed.
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext, UnitOfWork } from '../../../../core/database/unit-of-work';
import { ReferralRepository } from '../../repositories/referral.repository';
import { AmbassadorProfileRepository } from '../../repositories/ambassador-profile.repository';
import { AmbassadorEarningService } from '../../services/ambassador-earning.service';

export const SALE_EVENT = 'first_sale_facilitated';
const MINOR = /^\d{1,19}$/;

/** PURE: the commission base — the event's goods subtotal when it carries one, else the order row's (F-5). */
export function saleBase(payload: Record<string, unknown>, rowSubtotal: string | null): bigint | null {
  const fromEvent = payload.subtotalMinor;
  if (typeof fromEvent === 'string' && MINOR.test(fromEvent)) return BigInt(fromEvent);
  if (rowSubtotal !== null && MINOR.test(rowSubtotal)) return BigInt(rowSubtotal);
  return null;
}

export class OrderCompletedHandler implements OutboxHandler {
  readonly eventType = 'orders.order_completed';
  constructor(
    private readonly uow: UnitOfWork,
    private readonly referrals: ReferralRepository,
    private readonly profiles: AmbassadorProfileRepository,
    private readonly earnings: AmbassadorEarningService,
  ) {}
  async handle(event: OutboxEvent, _relayTx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const sellerUserId = event.payload.sellerUserId as string | undefined;
    if (!tenantId || !sellerUserId || !event.aggregateId) return;   // malformed event — fail closed
    await this.uow.run(tenantId, async (tx) => {
      const referral = await this.referrals.findByReferee(tenantId, sellerUserId, tx);
      if (!referral) return;                                          // seller wasn't referred → no commission
      const ambassador = await this.profiles.findByUser(tenantId, referral.referrerUserId, tx);
      if (!ambassador || !ambassador.isActive) return;
      let rowSubtotal: string | null = null;
      if (typeof event.payload.subtotalMinor !== 'string') {
        const r = await tx.query<{ s: string }>(`SELECT subtotal_minor::text AS s FROM orders WHERE id=$1 AND tenant_id=$2 LIMIT 1`, [event.aggregateId, tenantId]);
        rowSubtotal = r.rows[0]?.s ?? null;
      }
      const base = saleBase(event.payload, rowSubtotal);
      if (base === null) return;                                      // no goods subtotal recorded → no base → no commission
      await this.earnings.accrue(tx, { tenantId, ambassadorId: ambassador.id, eventCode: SALE_EVENT, referenceType: 'order', referenceId: event.aggregateId, baseMinor: base,
        subjectUserId: sellerUserId, referralCreatedAt: referral.createdAt ? new Date(referral.createdAt) : null });
    });
  }
}
