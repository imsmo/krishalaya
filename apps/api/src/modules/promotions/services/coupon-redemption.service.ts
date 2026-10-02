// modules/promotions/services/coupon-redemption.service.ts
// The redemption-ledger use-cases driven by the ORDER LIFECYCLE (outbox events), split out from CouponService (which owns
// the synchronous redeem at checkout):
//   • recordFromOrder — the order-created BACKSTOP: ensure a coupon an order carried is recorded exactly once.
//   • releaseForOrder — PC-56 TENANT-10b · A3: an order CANCELLED or REFUNDED before settlement gives its reservation back.
//
// BOTH RUN IN THE REQUEST-TIER UNIT OF WORK (kv_app, RLS-bound to the event's tenant), NEVER ON THE RELAY'S TRANSACTION.
// F-29 (found this wave, the F-27 class): the backstop used to run its INSERT into `coupon_redemptions` on the relay's
// connection as kv_relay, which holds NO privilege on that table (0014; DEV-47 pinned it) — so EVERY order created with a
// coupon had its `orders.order_created` event die 42501 and land in quarantine. Both acts are idempotent per order, so a
// relay retry after a later handler's failure does nothing twice.
import { Inject, Injectable } from '@nestjs/common';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { uuidv7 } from '../../../core/database/uuid.util';
import { CouponRedemption } from '../domain/coupon-redemption.entity';
import { PromotionEventType, DomainEvent } from '../domain/promotions.events';
import { CouponRepository } from '../repositories/coupon.repository';
import { PromotionRepository } from '../repositories/promotion.repository';
import { CouponRedemptionRepository } from '../repositories/coupon-redemption.repository';
import { CouponAttemptRepository } from '../repositories/coupon-attempt.repository';
import { CouponMoneyService } from './coupon-money.service';

@Injectable()
export class CouponRedemptionService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly coupons: CouponRepository,
    private readonly promos: PromotionRepository,
    private readonly redemptions: CouponRedemptionRepository,
    private readonly attempts: CouponAttemptRepository,
    private readonly money: CouponMoneyService,
  ) {}

  /**
   * The order-created BACKSTOP. For every order checkout placed, checkout already redeemed in its own transaction, so the
   * row exists and this is a no-op. It records a NEW redemption only for an order that honoured a coupon outside
   * checkout (no such path exists today) — and then it tries to RESERVE the discount like checkout does (A1). The discount
   * is already on that order and cannot be taken back, so if the tenant cannot fund it the redemption is recorded WITHOUT
   * a hold (`hold_txn_id` NULL, attempt `tenant_funds_unavailable`, stage `backstop`) and settlement pays no top-up for it:
   * that seller bears the discount, and W130 says so on the row. Never throws on budget (enforceBudget:false accounting).
   */
  async recordFromOrder(tenantId: string, input: { orderId: string; couponCode: string; userId: string; discountMinor: bigint }): Promise<{ recorded: boolean; held: boolean }> {
    if (input.discountMinor <= 0n) return { recorded: false, held: false };
    return this.uow.run(tenantId, async (tx) => {
      const coupon = await this.coupons.getByCodeForUpdate(tx, tenantId, input.couponCode);
      if (!coupon) return { recorded: false, held: false };                         // code no longer exists → nothing to record
      if (await this.redemptions.existsFor(tx, tenantId, coupon.id, input.orderId)) return { recorded: false, held: false };   // checkout recorded it

      const holdTxnId = await this.money.tryHold(tx, { tenantId, orderId: input.orderId, couponId: coupon.id, amountMinor: input.discountMinor, initiatedBy: input.userId });
      const redemption = CouponRedemption.create({ id: uuidv7(), couponId: coupon.id, tenantId, userId: input.userId, orderId: input.orderId, amountMinor: input.discountMinor });
      if (!(await this.redemptions.insert(tx, redemption, holdTxnId))) return { recorded: false, held: false };

      coupon.consumeUseUnchecked();
      await this.coupons.updateUses(tx, coupon);
      const events: DomainEvent[] = [{ type: PromotionEventType.CouponRedeemed, payload: { couponId: coupon.id, promotionId: coupon.promotionId, orderId: input.orderId, userId: input.userId, discountMinor: input.discountMinor.toString(), holdTxnId } }];
      const promo = coupon.promotionId ? await this.promos.getForUpdate(tx, tenantId, coupon.promotionId) : null;
      if (promo && holdTxnId) {
        promo.recordSpend(input.discountMinor, { enforceBudget: false });   // A6: spend moves only with a hold — and this one has one
        await this.promos.update(tx, promo);
        events.push(...promo.pullEvents());
      }
      await this.attempts.insert(tx, { tenantId, couponId: coupon.id, orderId: input.orderId, userId: input.userId, stage: 'backstop', outcome: holdTxnId ? 'applied' : 'tenant_funds_unavailable', amountMinor: input.discountMinor });
      await this.flush(tx, tenantId, coupon.id, events);
      return { recorded: true, held: holdTxnId !== null };
    }, { userId: 'system' });
  }

  /**
   * A3 — the order was CANCELLED (or REFUNDED) before settlement: every reservation it holds goes back to the tenant's
   * Main (tenant Hold −d → Main +d, keyed `promo-release:<orderId>:<couponId>`), the redemption is stamped released, the
   * coupon gets its use back and the promotion's spend drops by the reservation. A row already settled (the seller was
   * paid — a refund AFTER settlement is the payments/disputes plane's money, not this one's) or with no hold is left
   * alone. Locked FOR UPDATE, so a settlement racing this cannot pay the same reservation out twice.
   */
  async releaseForOrder(tenantId: string, orderId: string, cause: 'cancelled' | 'refunded'): Promise<{ released: number; amountMinor: bigint }> {
    return this.uow.run(tenantId, async (tx) => {
      const rows = await this.redemptions.forOrderForUpdate(tx, tenantId, orderId);
      let released = 0; let amount = 0n;
      for (const r of rows) {
        if (!r.holdTxnId || r.settledTxnId || r.releasedTxnId) continue;
        const txnId = await this.money.releaseInTx(tx, tenantId, r);
        const coupon = await this.coupons.getByIdForUpdate(tx, tenantId, r.couponId);
        const events: DomainEvent[] = [{ type: PromotionEventType.CouponReleased, payload: { couponId: r.couponId, orderId, redemptionId: r.id, amountMinor: r.amountMinor.toString(), releaseTxnId: txnId, cause } }];
        if (coupon) {
          coupon.releaseUse();
          await this.coupons.updateUses(tx, coupon);
          const promo = coupon.promotionId ? await this.promos.getForUpdate(tx, tenantId, coupon.promotionId) : null;
          if (promo) { promo.releaseSpend(r.amountMinor); await this.promos.update(tx, promo); }
        }
        await this.flush(tx, tenantId, r.couponId, events);
        released += 1; amount += r.amountMinor;
      }
      if (released > 0) this.metrics.inc('promotions.reservation_released', { tenant: tenantId, cause });
      return { released, amountMinor: amount };
    }, { userId: 'system' });
  }

  private async flush(tx: TxContext, tenantId: string, aggId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'coupon', aggregateId: aggId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
