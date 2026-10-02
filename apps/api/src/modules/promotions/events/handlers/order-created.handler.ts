// modules/promotions/events/handlers/order-created.handler.ts
// Consumes orders.order_created (delivered by the outbox relay). When an order was placed WITH a coupon, ensure the
// redemption is recorded against the coupon + promotion. This is the DECOUPLED / backstop path: the coupon code + applied
// discount travel IN the event (orders never imports promotions' repo — Law 11), and the recorder is idempotent per
// (coupon, order) — so for the normal flow, where checkout already redeemed synchronously in its own tx, this is a
// harmless no-op (the row exists).
//
// PC-56 TENANT-10b · F-29 — THE RELAY'S TRANSACTION IS NOT USED. It runs as kv_relay, which holds no privilege on
// coupon_redemptions; this handler used to INSERT through it and every coupon order's event died 42501 into quarantine.
// The recorder now runs in its own request-tier unit of work (kv_app, RLS-bound to the event's tenant). A recorder
// failure still fails the event (it is retried), it is never swallowed.
import { Injectable } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { CouponRedemptionService } from '../../services/coupon-redemption.service';

@Injectable()
export class OrderCreatedHandler implements OutboxHandler {
  readonly eventType = 'orders.order_created';
  constructor(private readonly redemptions: CouponRedemptionService) {}

  async handle(event: OutboxEvent, _relayTx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const p = event.payload as Record<string, unknown>;
    if (!tenantId) return;
    const couponCode = typeof p.couponCode === 'string' ? p.couponCode : undefined;
    const buyerUserId = typeof p.buyerUserId === 'string' ? p.buyerUserId : undefined;
    const orderId = typeof p.orderId === 'string' ? p.orderId : event.aggregateId;
    const discountMinor = typeof p.discountMinor === 'string' && /^\d+$/.test(p.discountMinor) ? BigInt(p.discountMinor) : 0n;
    if (!couponCode || !buyerUserId || discountMinor <= 0n) return;   // no coupon on this order → nothing to record
    await this.redemptions.recordFromOrder(tenantId, { orderId, couponCode, userId: buyerUserId, discountMinor });
  }
}
