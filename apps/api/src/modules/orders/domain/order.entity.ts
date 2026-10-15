// modules/orders/domain/order.entity.ts
// Order aggregate root. Pure domain: money in bigint minor units, status transitions ONLY via
// the state machine (Law 5), optimistic-locked by `version`. Created in 'created' (COD-style)
// or 'payment_pending' when online payment is required (the money step is owned by payments).
import { OrderStatus, assertTransition, isCancellable, IllegalOrderTransitionError } from './order.state';
import { OrderItem } from './order-item.entity';
import { OrderForbiddenError, OrderAwaitingPaymentError } from './orders.errors';
import { OrderEventType, DomainEvent } from './orders.events';

export interface OrderProps {
  id: string; tenantId: string; orderNo: string; checkoutGroupId: string | null;
  buyerUserId: string; sellerUserId: string; source: string; offerId: string | null; requirementId: string | null; currencyCode: string;
  subtotalMinor: bigint; deliveryFeeMinor: bigint; discountMinor: bigint; taxMinor: bigint;
  commissionMinor: bigint; platformFeeMinor: bigint; tdsMinor: bigint; totalMinor: bigint;
  status: OrderStatus; deliveryMethodId: string | null; deliveryAddressId: string | null;
  acceptanceDeadline: Date | null; qualityWindowEnds: Date | null;
  cancelReasonId: string | null; cancelledBy: string | null; version: number;
  createdAt: Date; completedAt: Date | null;
  /** PC-56 TENANT-3a: the charge rules this order was PRICED with, frozen at placement. 0005 has carried the
   *  column since day one and nothing ever wrote it, while W133/W134 promised "snapshotted at order time, never
   *  recalculated" — an immutability promise over an empty column. Written at checkout (the one place the rules
   *  are resolved); NULL on every order placed before this wave, which the read says rather than guesses. */
  commissionRuleSnapshot?: Record<string, unknown> | null;
  /** PC-56 TENANT-SW-a (0196). `commissionRuleSnapshot` above was always the CHARGE snapshot; it now lives under its true name
   *  (`orders.charge_snapshot`) and the old column is deprecated — the prop keeps its name for TENANT-3a's readers, the repository
   *  maps it to `charge_snapshot`. `commissionSnapshot` is the commission RULE frozen at placement (A2). */
  commissionSnapshot?: Record<string, unknown> | null;
  /** The delivery zone the buyer chose that served the pincode at placement (B1). */
  deliveryZoneId?: string | null;
  /** The commission + GST charged to the BUYER at placement when the frozen rule says charged_to=buyer (A4) — part of the total. */
  buyerCommissionMinor?: bigint;
  /** PC-56 STORE-2c · B1 (founder D1, 0209): when placement RESERVED this order's stock (each line's listing decremented under its row lock in
   *  the checkout transaction). Null = reserved nothing (placed before 0209; an offer / auction / requirement order) or already released.
   *  Cleared ONLY by the restock handler, in the transaction that puts the stock back (OrderRepository.releaseReservationTx). */
  stockReservedAt?: Date | null;
  /** PC-56 STORE-3a · B2 (0210 `orders.cancel_note`): the buyer's own words when the cancel reason's meta says textRequired (`other`). */
  cancelNote?: string | null;
}

const ACCEPTANCE_WINDOW_MS = 24 * 3600_000;
const QUALITY_WINDOW_MS = 24 * 3600_000;
/** PC-56 STORE-2c · C4 (founder D3): the quality window as the API states it to a buyer BEFORE placement (the checkout preview carries it) — the
 *  one figure every category gets today (survey F-24, Law 6: a per-category setting is owed). The storefront prints this number; no catalogue
 *  types it. */
export const QUALITY_WINDOW_HOURS = QUALITY_WINDOW_MS / 3_600_000;

export class Order {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: OrderProps) {}

  /** Build an order from priced items. requiresPayment ⇒ starts at payment_pending. */
  static place(input: {
    id: string; tenantId: string; orderNo: string; checkoutGroupId: string | null; buyerUserId: string;
    sellerUserId: string; source: string; offerId?: string | null; requirementId?: string | null; currencyCode: string; items: OrderItem[];
    deliveryFeeMinor?: bigint; platformFeeMinor?: bigint; discountMinor?: bigint; couponCode?: string | null; deliveryMethodId: string | null; deliveryAddressId: string | null;
    requiresPayment: boolean; now?: Date; commissionRuleSnapshot?: Record<string, unknown> | null;
    commissionSnapshot?: Record<string, unknown> | null; deliveryZoneId?: string | null; buyerCommissionMinor?: bigint;
    /** STORE-2c · D1: the checkout reserved every line's stock in the placement transaction (the caller decremented under the row locks). */
    stockReserved?: boolean;
  }): Order {
    const now = input.now ?? new Date();
    const subtotal = input.items.reduce((s, it) => s + it.props.lineTotalMinor, 0n);
    const delivery = input.deliveryFeeMinor ?? 0n;
    const platformFee = input.platformFeeMinor ?? 0n;   // BUYER-side platform fee (charged at checkout)
    const discount = input.discountMinor ?? 0n;
    const buyerCommission = input.buyerCommissionMinor ?? 0n;   // PC-56 TENANT-SW-a A4: a buyer-charged commission (+GST), frozen
    if (buyerCommission < 0n) throw new OrderForbiddenError('a buyer commission is never negative');
    // tax/commission/tds are settlement-time (0 here). The buyer platform fee + delivery (+ a buyer-charged commission) are charged
    // NOW and added to what the buyer pays; settlement routes them to the platform / tenant (not the seller).
    const total = subtotal + delivery + platformFee + buyerCommission - discount;
    const o = new Order({
      id: input.id, tenantId: input.tenantId, orderNo: input.orderNo, checkoutGroupId: input.checkoutGroupId,
      buyerUserId: input.buyerUserId, sellerUserId: input.sellerUserId, source: input.source, offerId: input.offerId ?? null, requirementId: input.requirementId ?? null, currencyCode: input.currencyCode,
      subtotalMinor: subtotal, deliveryFeeMinor: delivery, discountMinor: discount, taxMinor: 0n,
      commissionMinor: 0n, platformFeeMinor: platformFee, tdsMinor: 0n, totalMinor: total < 0n ? 0n : total,
      status: input.requiresPayment ? 'payment_pending' : 'created',
      deliveryMethodId: input.deliveryMethodId, deliveryAddressId: input.deliveryAddressId,
      acceptanceDeadline: new Date(now.getTime() + ACCEPTANCE_WINDOW_MS), qualityWindowEnds: null,
      cancelReasonId: null, cancelledBy: null, version: 1, createdAt: now, completedAt: null,
      commissionRuleSnapshot: input.commissionRuleSnapshot ?? null,
      commissionSnapshot: input.commissionSnapshot ?? null, deliveryZoneId: input.deliveryZoneId ?? null, buyerCommissionMinor: buyerCommission,
      stockReservedAt: input.stockReserved ? now : null,
    });
    // buyerUserId + discount + couponCode travel so the promotions module can record/back-stop the
    // coupon redemption from the event (decoupled — orders never imports promotions' repo; Law 11).
    o.events.push({ type: OrderEventType.Created, payload: {
      orderId: o.props.id, totalMinor: o.props.totalMinor.toString(), sellerUserId: o.props.sellerUserId,
      buyerUserId: o.props.buyerUserId, discountMinor: o.props.discountMinor.toString(),
      ...(input.couponCode ? { couponCode: input.couponCode } : {}),
    } });
    if (input.requiresPayment) o.events.push({ type: OrderEventType.PaymentRequired, payload: { orderId: o.props.id, totalMinor: o.props.totalMinor.toString() } });
    return o;
  }
  static rehydrate(props: OrderProps): Order { return new Order(props); }

  get id() { return this.props.id; }
  get status() { return this.props.status; }
  get version() { return this.props.version; }
  get buyerUserId() { return this.props.buyerUserId; }
  get sellerUserId() { return this.props.sellerUserId; }
  get createdAt() { return this.props.createdAt; }
  toProps(): Readonly<OrderProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /** What settlement needs, travelling in the event (Law 11). PC-56 TENANT-SW-a: + the buyer-charged commission and the frozen
   *  commission snapshot (settlement re-reads the ORDER's snapshot as the source of truth; the payload copy is for consumers). */
  private completionPayload(): Record<string, unknown> {
    return { buyerUserId: this.props.buyerUserId, sellerUserId: this.props.sellerUserId, totalMinor: this.props.totalMinor.toString(),
      deliveryFeeMinor: this.props.deliveryFeeMinor.toString(), platformFeeMinor: this.props.platformFeeMinor.toString(),
      buyerCommissionMinor: (this.props.buyerCommissionMinor ?? 0n).toString(), currencyCode: this.props.currencyCode, source: this.props.source,
      placedAt: this.props.createdAt instanceof Date ? this.props.createdAt.toISOString() : String(this.props.createdAt),
      ...(this.props.commissionSnapshot ? { commissionSnapshot: this.props.commissionSnapshot } : {}) };
  }

  private to(status: OrderStatus, evt: string, payload: Record<string, unknown> = {}, by?: string): void {
    const from = this.props.status;
    assertTransition(from, status);
    this.props.status = status;
    this.events.push({ type: OrderEventType.StatusChanged, payload: { orderId: this.props.id, from, to: status, by } });
    this.events.push({ type: evt, payload: { orderId: this.props.id, ...payload } });
  }

  /** Online payment succeeded → confirm (payments module calls this via event handler). */
  // PC-56 TENANT-3c-1: the confirm event now carries the order's MONEY COMPONENTS and its delivery address, because
  // the trade invoice is generated here (W151: "auto-generated on order confirm") and a statutory document must be
  // built from the amounts actually charged — not from a total with one blended rate applied to it. Same shape from
  // both doors (an online payment confirming itself, and a seller confirming) so the invoice cannot depend on which.
  private confirmedPayload(): Record<string, unknown> {
    return {
      buyerUserId: this.props.buyerUserId, sellerUserId: this.props.sellerUserId,
      subtotalMinor: this.props.subtotalMinor.toString(), deliveryFeeMinor: this.props.deliveryFeeMinor.toString(),
      discountMinor: this.props.discountMinor.toString(), platformFeeMinor: this.props.platformFeeMinor.toString(),
      totalMinor: this.props.totalMinor.toString(), currencyCode: this.props.currencyCode,
      deliveryAddressId: this.props.deliveryAddressId, source: this.props.source,
    };
  }
  markPaid(): void { if (this.props.status === 'payment_pending') this.to('confirmed', OrderEventType.Confirmed, this.confirmedPayload(), undefined); }
  /** PC-56 HOTFIX-4: the SELLER's confirm is for an order placed with no online payment (`created`). An order awaiting the buyer's online
   *  payment confirms ONLY through markPaid (the capture) — a seller confirm on it would ship an unpaid order and make "paid" a lie. */
  confirm(bySeller: string): void {
    this.assertSeller(bySeller);
    if (this.props.status === 'payment_pending') throw new OrderAwaitingPaymentError(this.props.id);
    this.to('confirmed', OrderEventType.Confirmed, this.confirmedPayload(), bySeller);
  }
  markPacked(bySeller: string): void { this.assertSeller(bySeller); this.to('packed', OrderEventType.Packed, {}, bySeller); }
  markReady(bySeller: string): void { this.assertSeller(bySeller); this.to('ready', OrderEventType.Ready, {}, bySeller); }
  markDelivered(by: string, now: Date = new Date()): void {
    this.to('delivered', OrderEventType.Delivered, { buyerUserId: this.props.buyerUserId, sellerUserId: this.props.sellerUserId }, by);
    this.props.qualityWindowEnds = new Date(now.getTime() + QUALITY_WINDOW_MS);
  }
  complete(now: Date = new Date()): void {
    // carry seller + amount so the payments module can settle escrow→seller without reading orders'
    // tables (cross-module data travels in the event, not via a foreign repository).
    this.to('completed', OrderEventType.Completed, this.completionPayload());
    this.props.completedAt = now;
  }
  /** Carrier/logistics confirmed physical delivery (the ground truth). Walks the order through the
   *  LEGAL state-machine edges to 'delivered' (the seller-driven manual chain may have been skipped
   *  once logistics owns fulfilment). Idempotent: a no-op (returns false) if already delivered/completed
   *  or in a state from which delivery doesn't apply (cancelled/refunded/disputed/pre-confirmation). */
  recordCarrierDelivery(now: Date = new Date()): boolean {
    const path: Partial<Record<OrderStatus, { to: OrderStatus; evt: string }>> = {
      confirmed:        { to: 'packed', evt: OrderEventType.Packed },
      packed:           { to: 'ready', evt: OrderEventType.Ready },
      ready:            { to: 'out_for_delivery', evt: OrderEventType.OutForDelivery },
      picked_up:        { to: 'delivered', evt: OrderEventType.Delivered },
      in_transit:       { to: 'delivered', evt: OrderEventType.Delivered },
      out_for_delivery: { to: 'delivered', evt: OrderEventType.Delivered },
    };
    const cur = (): OrderStatus => this.props.status;   // re-read each step (defeats over-narrowing)
    if (cur() === 'delivered' || cur() === 'completed') return false;
    if (!path[cur()]) return false;                     // cancelled/refunded/disputed/created/payment_pending → ignore
    let guard = 0;
    while (cur() !== 'delivered') {
      const hop = path[cur()];
      if (!hop || guard++ > 6) throw new OrderForbiddenError(`Cannot record carrier delivery from ${cur()}`);
      const payload = hop.to === 'delivered' ? { buyerUserId: this.props.buyerUserId, sellerUserId: this.props.sellerUserId } : {};
      this.to(hop.to, hop.evt, payload, 'system');       // each hop is a LEGAL edge (assertTransition enforces)
      if (hop.to === 'delivered') this.props.qualityWindowEnds = new Date(now.getTime() + QUALITY_WINDOW_MS);
    }
    return true;
  }

  dispute(by: string, note?: string): void { this.to('disputed', OrderEventType.Disputed, { note }, by); }

  /** Apply a dispute resolution from the disputes module (the order is in 'disputed'). refund_full →
   *  refunded; refund_partial → partially_refunded; rejected/replacement → completed (release to seller,
   *  carrying the settlement payload). Idempotent: a no-op (false) unless currently 'disputed'. */
  applyDisputeResolution(resolutionType: string, now: Date = new Date()): boolean {
    if (this.props.status !== 'disputed') return false;
    if (resolutionType === 'refund_full') { this.to('refunded', OrderEventType.Refunded, { buyerUserId: this.props.buyerUserId, totalMinor: this.props.totalMinor.toString() }, 'system'); return true; }
    if (resolutionType === 'refund_partial') { this.to('partially_refunded', OrderEventType.PartiallyRefunded, { buyerUserId: this.props.buyerUserId }, 'system'); return true; }
    // 'rejected' (dispute denied) or 'replacement' → the order completes (escrow releases to the seller)
    this.to('completed', OrderEventType.Completed, this.completionPayload(), 'system');
    this.props.completedAt = now;
    return true;
  }

  /** PC-56 STORE-3a · B2: + `reason` — the reason's CODE (carried in `orders.order_cancelled` as `reasonCode`, for consumers that must not read
   *  the vocabulary) and the buyer's `note` (stored on the order). An order past `ready` refuses the cancel as the STATE MACHINE's refusal
   *  (ORDER_ILLEGAL_TRANSITION, 409 — "it has moved forward"); it used to answer ORDER_FORBIDDEN (403), the code that also means "you are not a
   *  party to this order", so a buyer could not be told which of the two had happened (found building W3085). */
  cancel(by: string, reasonId: string | null, isBuyer: boolean, reason: { code?: string | null; note?: string | null } = {}): void {
    if (!isCancellable(this.props.status)) throw new IllegalOrderTransitionError(this.props.status, 'cancelled');
    if (isBuyer && this.props.buyerUserId !== by) throw new OrderForbiddenError();
    if (!isBuyer && this.props.sellerUserId !== by) throw new OrderForbiddenError();
    this.props.cancelReasonId = reasonId; this.props.cancelledBy = by; this.props.cancelNote = reason.note ?? null;
    this.to('cancelled', OrderEventType.Cancelled, { reasonId, ...(reason.code ? { reasonCode: reason.code } : {}), by, role: isBuyer ? 'buyer' : 'seller', ...this.cancelFacts() }, by);
  }

  /** PC-56 STORE-2c · B1/B2 (founder D1, D3): what the cancel's consumers need, additively — the stock-release handler re-reads its own marker
   *  and the refund handler its own payment (the payload is a hint, never the authority); the buyer travels for the notification map. */
  private cancelFacts(): Record<string, unknown> {
    return { buyerUserId: this.props.buyerUserId, sellerUserId: this.props.sellerUserId, totalMinor: this.props.totalMinor.toString(),
      currencyCode: this.props.currencyCode, stockReserved: !!this.props.stockReservedAt };
  }

  /** System/admin cancellation (jobs, moderation) — bypasses buyer/seller ownership but still
   *  obeys the state machine (only cancellable states). */
  systemCancel(reason: string): void {
    if (!isCancellable(this.props.status)) throw new OrderForbiddenError(`Order cannot be cancelled in status ${this.props.status}`);
    this.props.cancelledBy = 'system';
    this.to('cancelled', OrderEventType.Cancelled, { reason, by: 'system', role: 'system', ...this.cancelFacts() });
  }

  private assertSeller(by: string): void { if (this.props.sellerUserId !== by) throw new OrderForbiddenError('Only the seller may do this'); }
}
