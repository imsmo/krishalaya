// modules/promotions/events/handlers/order-closed.handler.ts · PC-56 TENANT-10b · A3 — A CLOSED ORDER GIVES ITS
// RESERVATION BACK.
//
// The orders module emits `orders.order_cancelled` (Order.cancel / the seller-confirm timeout) and `orders.order_refunded`
// (a dispute resolved refund_full). Either, BEFORE settlement, means the coupon discount the tenant reserved at checkout
// will never be paid to a seller — so it returns to the tenant's Main (CouponRedemptionService.releaseForOrder: tenant
// Hold → Main, keyed `promo-release:<orderId>:<couponId>`, the redemption stamped released, the coupon's use and the
// promotion's spend given back). After settlement the reservation is already the seller's and nothing here moves.
//
// `orders.order_partially_refunded` is NOT consumed, by name: a partial refund leaves the order open (it may still go
// `completed`, which settles), and splitting a reservation pro-rata has no rule anyone has decided. Named in the report.
//
// Runs in its own request-tier unit of work (kv_app), never on the relay's transaction (F-27 / F-29): the release writes
// coupon_redemptions.released_*, coupons.uses and promotions.spent_minor, which are kv_app's grants. Idempotent.
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { CouponRedemptionService } from '../../services/coupon-redemption.service';

export const ORDER_CLOSED_EVENTS = { 'orders.order_cancelled': 'cancelled', 'orders.order_refunded': 'refunded' } as const;
export type OrderClosedEvent = keyof typeof ORDER_CLOSED_EVENTS;

export class OrderClosedHandler implements OutboxHandler {
  constructor(readonly eventType: OrderClosedEvent, private readonly redemptions: CouponRedemptionService) {}

  async handle(event: OutboxEvent, _relayTx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const orderId = typeof (event.payload as Record<string, unknown>)?.orderId === 'string' ? String((event.payload as Record<string, unknown>).orderId) : event.aggregateId;
    if (!tenantId || !orderId) return;                                 // malformed event — nothing to release
    await this.redemptions.releaseForOrder(tenantId, orderId, ORDER_CLOSED_EVENTS[this.eventType]);
  }
}
