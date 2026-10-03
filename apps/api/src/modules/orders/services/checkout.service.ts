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
import { ChargePricingService, ZoneDelivery } from '../../payments/services/charge-pricing.service';
import { CommissionSnapshotService } from '../../payments/services/commission-snapshot.service';
import { CouponService } from '../../promotions/services/coupon.service';
import type { CouponNotice } from '../../promotions/domain/coupon-outcome';
import { UserMembershipService } from '../../memberships/services/user-membership.service';
import { DeliveryZoneRepository } from '../../logistics/repositories/delivery-zone.repository';
import { CartRepository } from '../repositories/cart.repository';
import { OrderRepository } from '../repositories/order.repository';
import { CheckoutGroupRepository } from '../repositories/checkout-group.repository';
import { Order } from '../domain/order.entity';
import { OrderItem } from '../domain/order-item.entity';
import { CheckoutGroup } from '../domain/checkout-group.entity';
import { DomainEvent } from '../domain/orders.events';
import { CartEmptyError, CartNotFoundError, ListingNotPurchasableError, InsufficientListingStockError,
  UnserviceablePincodeError, DeliveryAddressRequiredError, DeliveryMethodRequiredError, DeliveryMethodNotServingError } from '../domain/orders.errors';
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
    /** PC-56 TENANT-SW-a · A2 / A4 — payments' public service: freezes the commission rule (and a buyer-charged commission) at placement. */
    private readonly commission: CommissionSnapshotService,
  ) {}

  /**
   * PC-56 TENANT-SW-a · B1 (F-5) — THE ZONE THE BUYER IS CHARGED IS THE ZONE THE BUYER WAS QUOTED.
   *
   * `deliveryMethods` quoted each serviceable zone's own fee, and placement then charged the generic `delivery_fee` and never looked at
   * the chosen zone — or at whether ANY zone served the address. Now, when the tenant delivers by zone (≥ 1 active zone) and buyer
   * charges are on: the buyer's own address must be given; a pincode / region no active zone serves is refused with the kind code
   * UNSERVICEABLE_PINCODE ("we don't deliver here yet"); `deliveryMethodId` IS the zone id `deliveryMethods` returned (the field is now
   * the zone reference — it was stored and read by nothing); with no choice and exactly one serving zone, that zone; with several and no
   * choice, DELIVERY_METHOD_REQUIRED rather than a guessed fee. A tenant with no zones keeps the generic delivery fee (it never quoted a
   * zone). Returns null when zones do not apply.
   */
  private async resolveZone(tx: TxContext, tenantId: string, buyerUserId: string, dto: { deliveryAddressId?: string; deliveryMethodId?: string }, required: boolean): Promise<ZoneDelivery | null> {
    if ((await this.zones.activeCountTx(tx, tenantId)) === 0) return null;
    if (!dto.deliveryAddressId) { if (required) throw new DeliveryAddressRequiredError(); return null; }
    const addr = await this.orders.buyerAddressTx(tx, tenantId, buyerUserId, dto.deliveryAddressId);
    if (!addr) throw new DeliveryAddressRequiredError();
    const serving = await this.zones.serviceableTx(tx, tenantId, addr);
    if (serving.length === 0) throw new UnserviceablePincodeError(addr.pincode);
    const chosen = dto.deliveryMethodId ? serving.find((z) => z.id === dto.deliveryMethodId) : (serving.length === 1 ? serving[0] : undefined);
    if (dto.deliveryMethodId && !chosen) throw new DeliveryMethodNotServingError(dto.deliveryMethodId);
    if (!chosen) throw new DeliveryMethodRequiredError(serving.length);
    return { zoneId: chosen.id, chargeDefinitionId: chosen.toProps().chargeDefinitionId };
  }

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
        const commissionSplit = await this.flags.isEnabled('commission_split', { tenantId });
        let couponApplied = false;   // a coupon is redeemed against the PRIMARY (first) order only
        let couponNotice: CouponNotice | null = null;

        return this.uow.run(tenantId, async (tx) => {
          const cartId = await this.carts.activeIdForUpdate(tx, tenantId, buyerUserId);
          if (!cartId) throw new CartNotFoundError();
          const cartItems = await this.carts.itemsForUpdate(tx, cartId);
          if (cartItems.length === 0) throw new CartEmptyError();

          // resolve listings + group order items by seller
          const bySeller = new Map<string, { items: OrderItem[]; createdAt: Date; orderId: string; categories: Set<string> }>();
          for (const ci of cartItems) {
            const l: any = await this.listings.getById(tenantId, ci.listing_id);
            if (!l || l.status !== 'published') throw new ListingNotPurchasableError(ci.listing_id);
            const qty = Number(ci.quantity);
            if (Number(l.quantityAvailable) < qty) throw new InsufficientListingStockError(ci.listing_id, qty, Number(l.quantityAvailable));
            let g = bySeller.get(l.sellerUserId);
            if (!g) { const orderId = uuidv7(); g = { items: [], createdAt: new Date(), orderId, categories: new Set<string>() }; bySeller.set(l.sellerUserId, g); }
            if (l.categoryId) g.categories.add(String(l.categoryId));
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

          // B1: the chosen zone (when the tenant delivers by zone), resolved ONCE for the address, inside this transaction
          const zone = applyCharges ? await this.resolveZone(tx, tenantId, buyerUserId, dto, true) : null;

          const created: Array<{ id: string; orderNo: string; totalMinor: string; status: string }> = [];
          for (const [sellerUserId, g] of bySeller) {
            await this.quota.assertWithinLimit(tenantId, QUOTA);
            // buyer-side charges (delivery slab + platform fee) on this seller's subtotal — flagged
            const subtotal = g.items.reduce((a, it) => a + it.props.lineTotalMinor, 0n);
            // PC-56 TENANT-3a: the same two charges, PLUS the rules they came from — frozen onto the order so
            // W133/W134's "snapshotted at order time, never recalculated" stops being a promise over a column
            // (commission_rule_snapshot) that nothing had ever written since 0005.
            const quoted = applyCharges
              ? await this.charges.checkoutChargesWithSnapshot(tx, tenantId, subtotal, g.createdAt, zone)
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
            // coupon discount: redeemed atomically in THIS tx against the primary order (promotions flag).
            // PC-56 TENANT-10b · F-2 / F-21: the redemption RESERVES the discount from the tenant's wallet; a decline (no
            // tenant funds, spent budget, per-user limit, ended window, unknown code…) no longer aborts the checkout — the
            // order is placed at FULL price and the result carries the buyer's kind notice (a message key, not an error code).
            let discountMinor = 0n;
            if (applyCoupon && !couponApplied) {
              const r = await this.coupons.redeemInTx(tx, tenantId, buyerUserId, { code: dto.couponCode!, orderId: g.orderId, subtotalMinor: subtotal });
              if (r.applied) discountMinor = BigInt(r.discountMinor);
              else couponNotice = r.notice;
              couponApplied = true;
            }
            // A2 · THE COMMISSION RULE IS FROZEN HERE (placement day, IST) — settlement reads this and never resolves again.
            // A4 · a rule that charges the BUYER (with the split on) adds the commission + GST to this order as a buyer charge.
            const frozen = await this.commission.freezeAtPlacement(tx, { tenantId, source: 'direct', categoryId: g.categories.size === 1 ? [...g.categories][0] : null,
              goodsMinor: subtotal, splitOn: commissionSplit, now: g.createdAt });
            let snapshotOut = chargeSnapshot as Record<string, unknown> | null;
            if (frozen.chargeEntry) {
              snapshotOut = snapshotOut
                ? { ...snapshotOut, charges: [...((snapshotOut.charges as unknown[]) ?? []), frozen.chargeEntry] }
                : { resolvedAt: g.createdAt.toISOString(), charges: [frozen.chargeEntry] };
            }
            const order = Order.place({ id: g.orderId, tenantId, orderNo: orderNo(g.orderId), checkoutGroupId, buyerUserId,
              sellerUserId, source: 'direct', currencyCode: 'INR', items: g.items, deliveryFeeMinor, platformFeeMinor, discountMinor,
              couponCode: discountMinor > 0n ? (dto.couponCode ?? null) : null,
              deliveryMethodId: zone?.zoneId ?? dto.deliveryMethodId ?? null, deliveryAddressId: dto.deliveryAddressId ?? null, requiresPayment, now: g.createdAt,
              commissionRuleSnapshot: snapshotOut,
              commissionSnapshot: frozen.snapshot as unknown as Record<string, unknown>, deliveryZoneId: zone?.zoneId ?? null, buyerCommissionMinor: frozen.buyerCommissionMinor });
            await this.orders.insertGraph(tx, order, g.items);
            await this.quota.increment(tx, tenantId, QUOTA, 1);
            await this.flush(tx, tenantId, g.orderId, order.pullEvents());
            const p = order.toProps();
            created.push({ id: p.id, orderNo: p.orderNo, totalMinor: p.totalMinor.toString(), status: p.status });
          }
          await this.carts.markConverted(tx, cartId);
          this.metrics.inc('orders.checkout_done', { tenant: tenantId, orders: String(created.length) });
          return { orders: created, checkoutGroupId, ...(couponNotice ? { couponNotice } : {}) };
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
    const bySeller = new Map<string, { items: OrderItem[]; subtotalMinor: bigint; categoryIds: Set<string> }>();
    const order: string[] = [];
    for (const ci of cartItems) {
      const l: any = await this.listings.getById(tenantId, ci.listing_id);
      if (!l || l.status !== 'published') throw new ListingNotPurchasableError(ci.listing_id);
      const qty = Number(ci.quantity);
      if (Number(l.quantityAvailable) < qty) throw new InsufficientListingStockError(ci.listing_id, qty, Number(l.quantityAvailable));
      let g = bySeller.get(l.sellerUserId);
      if (!g) { g = { items: [], subtotalMinor: 0n, categoryIds: new Set<string>() }; bySeller.set(l.sellerUserId, g); order.push(l.sellerUserId); }
      if (l.categoryId) g.categoryIds.add(String(l.categoryId));
      const item = OrderItem.of({ id: uuidv7(), orderId: 'preview', orderCreatedAt: new Date(), tenantId, listingId: ci.listing_id,
        productId: l.productId, titleSnapshot: l.title, quantity: qty, unitCode: l.unitCode, unitPriceMinor: BigInt(l.priceMinor),
        gstRatePct: null, hsnCode: null, batchId: null });
      g.items.push(item);
      g.subtotalMinor += item.props.lineTotalMinor;
    }

    const commissionSplit = await this.flags.isEnabled('commission_split', { tenantId });
    let deliveryNeedsAddress = false;
    const sellers = await this.uow.run(tenantId, async (tx) => {
      let couponDone = false;
      const out: Array<Record<string, unknown>> = [];
      // PC-56 TENANT-SW-a · B1: the same zone placement will charge (when an address is given); without an address a zone tenant's
      // delivery fee is not knowable yet, and the preview says so (deliveryNeedsAddress) instead of showing the generic slab.
      const zonesApply = applyCharges && (await this.zones.activeCountTx(tx, tenantId)) > 0;
      const zone = zonesApply ? await this.resolveZone(tx, tenantId, buyerUserId, dto, false) : null;
      deliveryNeedsAddress = zonesApply && !zone;
      for (const sellerUserId of order) {
        const g = bySeller.get(sellerUserId)!;
        let { deliveryFeeMinor, platformFeeMinor } = applyCharges
          ? (zonesApply
            ? await this.charges.checkoutChargesWithSnapshot(tx, tenantId, g.subtotalMinor, new Date(), zone).then((c) => ({ deliveryFeeMinor: zone ? c.deliveryFeeMinor : 0n, platformFeeMinor: c.platformFeeMinor }))
            : await this.charges.checkoutCharges(tx, tenantId, g.subtotalMinor))
          : { deliveryFeeMinor: 0n, platformFeeMinor: 0n };
        if (applyCharges && applyMemberBenefits) {
          const ben = await this.memberships.checkoutBenefits(tx, tenantId, buyerUserId);
          if (ben) {
            if (ben.freeDelivery) deliveryFeeMinor = 0n;
            if (ben.platformFeeBpsOverride != null) platformFeeMinor = applyBpsFloor(g.subtotalMinor, ben.platformFeeBpsOverride);
          }
        }
        // coupon DRY-RUN against the primary seller only (never redeemed here).
        // PC-56 TENANT-10b · A5 / F-22: the preview asks the SAME decision checkout makes (per-user limit, budget, the
        // tenant's funds), so what the buyer is shown is what checkout will do. A decline carries the kind notice;
        // `couponError` keeps the outcome's machine code for clients that predate `couponNotice`.
        let discountMinor = 0n; let couponError: string | null = null; let couponNotice: CouponNotice | null = null;
        if (applyCoupon && !couponDone) {
          couponDone = true;
          try {
            const v = await this.coupons.validate(tenantId, buyerUserId, dto.couponCode!, g.subtotalMinor);
            if (v.applied) discountMinor = BigInt(v.discountMinor);
            else { couponNotice = v.notice; couponError = v.notice.code; }
          } catch (e) { couponError = e instanceof DomainError ? (e as any).code ?? 'COUPON_INVALID' : 'COUPON_INVALID'; }
        }
        // A4: a rule charging the buyer (split on) adds its commission + GST — the same figure placement freezes
        const frozen = await this.commission.freezeAtPlacement(tx, { tenantId, source: 'direct', categoryId: g.categoryIds.size === 1 ? [...g.categoryIds][0] : null,
          goodsMinor: g.subtotalMinor, splitOn: commissionSplit });
        const buyerCommissionMinor = frozen.buyerCommissionMinor;
        const total = g.subtotalMinor + deliveryFeeMinor + platformFeeMinor + buyerCommissionMinor - discountMinor;
        out.push({ buyerCommissionMinor: buyerCommissionMinor.toString(),
          sellerUserId,
          items: g.items.map((it) => ({ listingId: it.props.listingId, title: it.props.titleSnapshot, quantity: it.props.quantity, unitCode: it.props.unitCode, unitPriceMinor: it.props.unitPriceMinor.toString(), lineTotalMinor: it.props.lineTotalMinor.toString() })),
          subtotalMinor: g.subtotalMinor.toString(), deliveryFeeMinor: deliveryFeeMinor.toString(), platformFeeMinor: platformFeeMinor.toString(),
          discountMinor: discountMinor.toString(), totalMinor: (total < 0n ? 0n : total).toString(),
          ...(couponError ? { couponError } : {}),
          ...(couponNotice ? { couponNotice } : {}),
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
      buyerCommissionMinor: sum('buyerCommissionMinor').toString(),
      deliveryNeedsAddress,
      grandTotalMinor: grandTotal.toString(),
      couponCode: sellers.some((s) => BigInt((s.discountMinor as string)) > 0n) ? (dto.couponCode ?? null) : null,
    };
  }

  private async flush(tx: TxContext, tenantId: string, orderId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'order', aggregateId: orderId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
