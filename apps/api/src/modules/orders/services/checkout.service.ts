// modules/orders/services/checkout.service.ts
// Converts the buyer's active cart into ONE order per seller (+ a checkout group when
// multi-seller). All in ONE ACID tx with outbox events (Law 4); idempotent (Law 3); quota
// enforced. The MONEY step is owned by the payments module: if the `online_payments` flag is
// on, orders start at payment_pending and emit orders.payment_required; otherwise COD-style
// 'created' awaiting seller confirm. Item prices/titles are SNAPSHOT into the order.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { QUOTA_SERVICE, QuotaService } from '../../../core/quota/quota.service';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { FlagsService } from '../../../core/feature-flags/flags.service';
// [QA-FIX 2026-07-28] DEV-26/Q15: both `platformFeeBpsOverride` sites below inlined the identical
// `(amount * BigInt(bps)) / 10000n` floor-division formula the batch's grep was supposed to find and
// consolidate — missed here (2 call sites). Delegated to the one canonical helper; identical bigint math, zero
// behavior change.
import { applyBpsFloor } from '../../../core/money/rounding';
import { uuidv7 } from '../../../core/database/uuid.util';
import { ListingService } from '../../listings/services/listing.service';
import { ChargePricingService } from '../../payments/services/charge-pricing.service';
import { CouponService } from '../../promotions/services/coupon.service';
import { UserMembershipService } from '../../memberships/services/user-membership.service';
import { DeliveryZoneRepository } from '../../logistics/repositories/delivery-zone.repository';
import { CartRepository } from '../repositories/cart.repository';
import { OrderRepository } from '../repositories/order.repository';
import { CheckoutGroupRepository } from '../repositories/checkout-group.repository';
import { Order } from '../domain/order.entity';
import { OrderItem } from '../domain/order-item.entity';
import { CheckoutGroup } from '../domain/checkout-group.entity';
import { DomainEvent } from '../domain/orders.events';
import { CartEmptyError, CartNotFoundError, ListingNotPurchasableError, InsufficientListingStockError } from '../domain/orders.errors';
import { CheckoutDto, CheckoutPreviewDto } from '../dto/create-order.dto';
import { DomainError } from '../../../shared/errors/app-error';

const QUOTA = 'max_orders_month';
function orderNo(id: string): string { return `KV${new Date().getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`; }

@Injectable()
export class CheckoutService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(QUOTA_SERVICE) private readonly quota: QuotaService,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly flags: FlagsService,
    private readonly listings: ListingService,
    private readonly carts: CartRepository,
    private readonly orders: OrderRepository,
    private readonly checkoutGroups: CheckoutGroupRepository,
    private readonly charges: ChargePricingService,
    private readonly coupons: CouponService,
    private readonly memberships: UserMembershipService,
    private readonly zones: DeliveryZoneRepository,
  ) {}

  /** READ-ONLY delivery-methods lookup for the active cart + a destination (pincode and/or regionId). Returns
   *  the serviceable delivery zones with their REAL per-zone fee (resolved from each zone's charge_definition
   *  against the live cart subtotal, so slab fees are accurate). No order, no money moved. When no zone serves
   *  the destination the list is empty — the storefront falls back to the preview's generic delivery fee
   *  (placement always recomputes server-side). Never fabricates a method or a fee. */
  async deliveryMethods(tenantId: string, buyerUserId: string, q: { pincode?: string; regionId?: string }) {
    const cartId = await this.carts.activeId(tenantId, buyerUserId);
    if (!cartId) throw new CartNotFoundError();
    const cartItems = await this.carts.items(tenantId, cartId);
    if (cartItems.length === 0) throw new CartEmptyError();

    // server-truth subtotal (price snapshot exactly as checkout would), so slab delivery fees are accurate.
    let subtotalMinor = 0n;
    for (const ci of cartItems) {
      const l: any = await this.listings.getById(tenantId, ci.listing_id);
      if (!l || l.status !== 'published') throw new ListingNotPurchasableError(ci.listing_id);
      subtotalMinor += BigInt(l.priceMinor) * BigInt(Number(ci.quantity));
    }

    const serviceable = await this.zones.listServiceable(tenantId, { pincode: q.pincode, regionId: q.regionId, limit: 25 });
    const methods = await this.uow.run(tenantId, async (tx) => {
      const out: Array<{ id: string; name: string; feeMinor: string }> = [];
      for (const z of serviceable) {
        const p = z.toProps();
        const feeMinor = p.chargeDefinitionId
          ? await this.charges.quoteByDefinitionId(tx, tenantId, p.chargeDefinitionId, { amountMinor: subtotalMinor })
          : 0n;
        out.push({ id: p.id, name: p.defaultName, feeMinor: feeMinor.toString() });
      }
      return out;
    }, { userId: buyerUserId });

    return { currencyCode: 'INR', subtotalMinor: subtotalMinor.toString(), methods };
  }

  async checkout(tenantId: string, buyerUserId: string, idemKey: string, dto: CheckoutDto) {
    return this.idem.remember(idemKey, buyerUserId, 'orders.checkout', () =>
      timed(this.metrics, 'orders.checkout', { tenant: tenantId }, async () => {
        const requiresPayment = await this.flags.isEnabled('online_payments', { tenantId, userId: buyerUserId });
        const applyCharges = await this.flags.isEnabled('buyer_charges', { tenantId, userId: buyerUserId });
        const applyCoupon = dto.couponCode ? await this.flags.isEnabled('promotions', { tenantId, userId: buyerUserId }) : false;
        const applyMemberBenefits = await this.flags.isEnabled('memberships', { tenantId, userId: buyerUserId });
        let couponApplied = false;   // a coupon is redeemed against the PRIMARY (first) order only

        return this.uow.run(tenantId, async (tx) => {
          const cartId = await this.carts.activeIdForUpdate(tx, tenantId, buyerUserId);
          if (!cartId) throw new CartNotFoundError();
          const cartItems = await this.carts.itemsForUpdate(tx, cartId);
          if (cartItems.length === 0) throw new CartEmptyError();

          // resolve listings + group order items by seller
          const bySeller = new Map<string, { items: OrderItem[]; createdAt: Date; orderId: string }>();
          for (const ci of cartItems) {
            const l: any = await this.listings.getById(tenantId, ci.listing_id);
            if (!l || l.status !== 'published') throw new ListingNotPurchasableError(ci.listing_id);
            const qty = Number(ci.quantity);
            if (Number(l.quantityAvailable) < qty) throw new InsufficientListingStockError(ci.listing_id, qty, Number(l.quantityAvailable));
            let g = bySeller.get(l.sellerUserId);
            if (!g) { const orderId = uuidv7(); g = { items: [], createdAt: new Date(), orderId }; bySeller.set(l.sellerUserId, g); }
            g.items.push(OrderItem.of({ id: uuidv7(), orderId: g.orderId, orderCreatedAt: g.createdAt, tenantId, listingId: ci.listing_id,
              productId: l.productId, titleSnapshot: l.title, quantity: qty, unitCode: l.unitCode, unitPriceMinor: BigInt(l.priceMinor),
              gstRatePct: null, hsnCode: null, batchId: null }));
          }

          // multi-seller cart → one checkout GROUP (one payment spanning the per-seller sub-orders).
          const checkoutGroupId = bySeller.size > 1 ? uuidv7() : null;
          if (checkoutGroupId) {
            const total = [...bySeller.values()].reduce((s, g) => s + g.items.reduce((a, it) => a + it.props.lineTotalMinor, 0n), 0n);
            await this.checkoutGroups.insert(tx, CheckoutGroup.of({ id: checkoutGroupId, tenantId, buyerUserId, totalMinor: total, currencyCode: 'INR' }));
          }

          const created: Array<{ id: string; orderNo: string; totalMinor: string; status: string }> = [];
          for (const [sellerUserId, g] of bySeller) {
            await this.quota.assertWithinLimit(tenantId, QUOTA);
            // buyer-side charges (delivery slab + platform fee) on this seller's subtotal — flagged
            const subtotal = g.items.reduce((a, it) => a + it.props.lineTotalMinor, 0n);
            // PC-56 TENANT-3a: the same two charges, PLUS the rules they came from — frozen onto the order so
            // W133/W134's "snapshotted at order time, never recalculated" stops being a promise over a column
            // (commission_rule_snapshot) that nothing had ever written since 0005.
            const quoted = applyCharges
              ? await this.charges.checkoutChargesWithSnapshot(tx, tenantId, subtotal, g.createdAt)
              : { deliveryFeeMinor: 0n, platformFeeMinor: 0n, snapshot: null };
            let { deliveryFeeMinor, platformFeeMinor } = quoted;
            const chargeSnapshot = quoted.snapshot;
            // membership benefits override the buyer-side charges (free delivery + sliding platform fee)
            if (applyCharges && applyMemberBenefits) {
              const ben = await this.memberships.checkoutBenefits(tx, tenantId, buyerUserId);
              if (ben) {
                if (ben.freeDelivery) deliveryFeeMinor = 0n;
                if (ben.platformFeeBpsOverride != null) platformFeeMinor = applyBpsFloor(subtotal, ben.platformFeeBpsOverride);
                // **THE OVERRIDE GOES INTO THE SNAPSHOT TOO, OR THE SNAPSHOT LIES.** A membership benefit changes
                // the amount AFTER the rules were resolved; freezing only the rules would leave an accountant
                // reading a ₹340 delivery slab against a ₹0 charge and finding no explanation on the record.
                if (chargeSnapshot) {
                  chargeSnapshot.memberBenefit = {
                    freeDelivery: ben.freeDelivery === true,
                    platformFeeBpsOverride: ben.platformFeeBpsOverride ?? null,
                    appliedDeliveryFeeMinor: deliveryFeeMinor.toString(),
                    appliedPlatformFeeMinor: platformFeeMinor.toString(),
                  };
                }
              }
            }
            // coupon discount: redeemed atomically in THIS tx against the primary order (promotions flag)
            let discountMinor = 0n;
            if (applyCoupon && !couponApplied) {
              const r = await this.coupons.redeemInTx(tx, tenantId, buyerUserId, { code: dto.couponCode!, orderId: g.orderId, subtotalMinor: subtotal });
              discountMinor = BigInt(r.discountMinor);
              couponApplied = true;
            }
            const order = Order.place({ id: g.orderId, tenantId, orderNo: orderNo(g.orderId), checkoutGroupId, buyerUserId,
              sellerUserId, source: 'direct', currencyCode: 'INR', items: g.items, deliveryFeeMinor, platformFeeMinor, discountMinor,
              couponCode: discountMinor > 0n ? (dto.couponCode ?? null) : null,
              deliveryMethodId: dto.deliveryMethodId ?? null, deliveryAddressId: dto.deliveryAddressId ?? null, requiresPayment, now: g.createdAt,
              commissionRuleSnapshot: chargeSnapshot as Record<string, unknown> | null });
            await this.orders.insertGraph(tx, order, g.items);
            await this.quota.increment(tx, tenantId, QUOTA, 1);
            await this.flush(tx, tenantId, g.orderId, order.pullEvents());
            const p = order.toProps();
            created.push({ id: p.id, orderNo: p.orderNo, totalMinor: p.totalMinor.toString(), status: p.status });
          }
          await this.carts.markConverted(tx, cartId);
          this.metrics.inc('orders.checkout_done', { tenant: tenantId, orders: String(created.length) });
          return { orders: created, checkoutGroupId };
        }, { userId: buyerUserId });
      }));
  }

  /** READ-ONLY totals preview: the same money math as checkout (subtotal + buyer charges + member
   *  benefits + coupon), but no order is created, no quota consumed, no money moved. Lets the client
   *  show an authoritative bill before committing. Coupon is a DRY-RUN (validate, never redeemed) and
   *  applies to the PRIMARY (first) seller only, mirroring checkout. All money as minor-unit strings. */
  async previewTotals(tenantId: string, buyerUserId: string, dto: CheckoutPreviewDto) {
    const applyCharges = await this.flags.isEnabled('buyer_charges', { tenantId, userId: buyerUserId });
    const applyMemberBenefits = await this.flags.isEnabled('memberships', { tenantId, userId: buyerUserId });
    const applyCoupon = dto.couponCode ? await this.flags.isEnabled('promotions', { tenantId, userId: buyerUserId }) : false;

    const cartId = await this.carts.activeId(tenantId, buyerUserId);
    if (!cartId) throw new CartNotFoundError();
    const cartItems = await this.carts.items(tenantId, cartId);
    if (cartItems.length === 0) throw new CartEmptyError();

    // group by seller, snapshotting price/title exactly as checkout would (honest, server-truth).
    const bySeller = new Map<string, { items: OrderItem[]; subtotalMinor: bigint }>();
    const order: string[] = [];
    for (const ci of cartItems) {
      const l: any = await this.listings.getById(tenantId, ci.listing_id);
      if (!l || l.status !== 'published') throw new ListingNotPurchasableError(ci.listing_id);
      const qty = Number(ci.quantity);
      if (Number(l.quantityAvailable) < qty) throw new InsufficientListingStockError(ci.listing_id, qty, Number(l.quantityAvailable));
      let g = bySeller.get(l.sellerUserId);
      if (!g) { g = { items: [], subtotalMinor: 0n }; bySeller.set(l.sellerUserId, g); order.push(l.sellerUserId); }
      const item = OrderItem.of({ id: uuidv7(), orderId: 'preview', orderCreatedAt: new Date(), tenantId, listingId: ci.listing_id,
        productId: l.productId, titleSnapshot: l.title, quantity: qty, unitCode: l.unitCode, unitPriceMinor: BigInt(l.priceMinor),
        gstRatePct: null, hsnCode: null, batchId: null });
      g.items.push(item);
      g.subtotalMinor += item.props.lineTotalMinor;
    }

    const sellers = await this.uow.run(tenantId, async (tx) => {
      let couponDone = false;
      const out: Array<Record<string, unknown>> = [];
      for (const sellerUserId of order) {
        const g = bySeller.get(sellerUserId)!;
        let { deliveryFeeMinor, platformFeeMinor } = applyCharges
          ? await this.charges.checkoutCharges(tx, tenantId, g.subtotalMinor)
          : { deliveryFeeMinor: 0n, platformFeeMinor: 0n };
        if (applyCharges && applyMemberBenefits) {
          const ben = await this.memberships.checkoutBenefits(tx, tenantId, buyerUserId);
          if (ben) {
            if (ben.freeDelivery) deliveryFeeMinor = 0n;
            if (ben.platformFeeBpsOverride != null) platformFeeMinor = applyBpsFloor(g.subtotalMinor, ben.platformFeeBpsOverride);
          }
        }
        // coupon DRY-RUN against the primary seller only (never redeemed here).
        let discountMinor = 0n; let couponError: string | null = null;
        if (applyCoupon && !couponDone) {
          couponDone = true;
          try { discountMinor = BigInt((await this.coupons.validate(tenantId, dto.couponCode!, g.subtotalMinor)).discountMinor); }
          catch (e) { couponError = e instanceof DomainError ? (e as any).code ?? 'COUPON_INVALID' : 'COUPON_INVALID'; }
        }
        const total = g.subtotalMinor + deliveryFeeMinor + platformFeeMinor - discountMinor;
        out.push({
          sellerUserId,
          items: g.items.map((it) => ({ listingId: it.props.listingId, title: it.props.titleSnapshot, quantity: it.props.quantity, unitCode: it.props.unitCode, unitPriceMinor: it.props.unitPriceMinor.toString(), lineTotalMinor: it.props.lineTotalMinor.toString() })),
          subtotalMinor: g.subtotalMinor.toString(), deliveryFeeMinor: deliveryFeeMinor.toString(), platformFeeMinor: platformFeeMinor.toString(),
          discountMinor: discountMinor.toString(), totalMinor: (total < 0n ? 0n : total).toString(),
          ...(couponError ? { couponError } : {}),
        });
      }
      return out;
    }, { userId: buyerUserId });

    // grand totals (sum the per-seller breakdown — all integer minor units).
    const sum = (k: string) => sellers.reduce((a, s) => a + BigInt(s[k] as string), 0n);
    const grandTotal = sum('totalMinor');
    return {
      currencyCode: 'INR',
      sellers,
      subtotalMinor: sum('subtotalMinor').toString(),
      deliveryFeeMinor: sum('deliveryFeeMinor').toString(),
      platformFeeMinor: sum('platformFeeMinor').toString(),
      discountMinor: sum('discountMinor').toString(),
      grandTotalMinor: grandTotal.toString(),
      couponCode: sellers.some((s) => BigInt((s.discountMinor as string)) > 0n) ? (dto.couponCode ?? null) : null,
    };
  }

  private async flush(tx: TxContext, tenantId: string, orderId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'order', aggregateId: orderId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
