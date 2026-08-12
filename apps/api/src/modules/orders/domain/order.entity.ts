// modules/orders/domain/order.entity.ts
// Order aggregate root. Pure domain: money in bigint minor units, status transitions ONLY via
// the state machine (Law 5), optimistic-locked by `version`. Created in 'created' (COD-style)
// or 'payment_pending' when online payment is required (the money step is owned by payments).
import { OrderStatus, assertTransition, isCancellable } from './order.state';
import { OrderItem } from './order-item.entity';
import { OrderForbiddenError } from './orders.errors';
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
}

const ACCEPTANCE_WINDOW_MS = 24 * 3600_000;
const QUALITY_WINDOW_MS = 24 * 3600_000;

export class Order {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: OrderProps) {}

  /** Build an order from priced items. requiresPayment ⇒ starts at payment_pending. */
  static place(input: {
    id: string; tenantId: string; orderNo: string; checkoutGroupId: string | null; buyerUserId: string;
    sellerUserId: string; source: string; offerId?: string | null; requirementId?: string | null; currencyCode: string; items: OrderItem[];
    deliveryFeeMinor?: bigint; platformFeeMinor?: bigint; discountMinor?: bigint; couponCode?: string | null; deliveryMethodId: string | null; deliveryAddressId: string | null;
    requiresPayment: boolean; now?: Date; commissionRuleSnapshot?: Record<string, unknown> | null;
  }): Order {
    const now = input.now ?? new Date();
    const subtotal = input.items.reduce((s, it) => s + it.props.lineTotalMinor, 0n);
    const delivery = input.deliveryFeeMinor ?? 0n;
    const platformFee = input.platformFeeMinor ?? 0n;   // BUYER-side platform fee (charged at checkout)
    const discount = input.discountMinor ?? 0n;
    // tax/commission/tds are settlement-time (0 here). The buyer platform fee + delivery are charged
    // NOW and added to what the buyer pays; settlement routes them to the platform (not the seller).
    const total = subtotal + delivery + platformFee - discount;
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
  confirm(bySeller: string): void { this.assertSeller(bySeller); this.to('confirmed', OrderEventType.Confirmed, this.confirmedPayload(), bySeller); }
  markPacked(bySeller: string): void { this.assertSeller(bySeller); this.to('packed', OrderEventType.Packed, {}, bySeller); }
  markReady(bySeller: string): void { this.assertSeller(bySeller); this.to('ready', OrderEventType.Ready, {}, bySeller); }
  markDelivered(by: string, now: Date = new Date()): void {
    this.to('delivered', OrderEventType.Delivered, { buyerUserId: this.props.buyerUserId, sellerUserId: this.props.sellerUserId }, by);
    this.props.qualityWindowEnds = new Date(now.getTime() + QUALITY_WINDOW_MS);
  }
  complete(now: Date = new Date()): void {
    // carry seller + amount so the payments module can settle escrow→seller without reading orders'
    // tables (cross-module data travels in the event, not via a foreign repository).
    this.to('completed', OrderEventType.Completed, { buyerUserId: this.props.buyerUserId, sellerUserId: this.props.sellerUserId, totalMinor: this.props.totalMinor.toString(), deliveryFeeMinor: this.props.deliveryFeeMinor.toString(), platformFeeMinor: this.props.platformFeeMinor.toString(), currencyCode: this.props.currencyCode, source: this.props.source });
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
    this.to('completed', OrderEventType.Completed, { buyerUserId: this.props.buyerUserId, sellerUserId: this.props.sellerUserId, totalMinor: this.props.totalMinor.toString(), deliveryFeeMinor: this.props.deliveryFeeMinor.toString(), platformFeeMinor: this.props.platformFeeMinor.toString(), currencyCode: this.props.currencyCode, source: this.props.source }, 'system');
    this.props.completedAt = now;
    return true;
  }

  cancel(by: string, reasonId: string | null, isBuyer: boolean): void {
    if (!isCancellable(this.props.status)) throw new OrderForbiddenError(`Order cannot be cancelled in status ${this.props.status}`);
    if (isBuyer && this.props.buyerUserId !== by) throw new OrderForbiddenError();
    if (!isBuyer && this.props.sellerUserId !== by) throw new OrderForbiddenError();
    this.props.cancelReasonId = reasonId; this.props.cancelledBy = by;
    this.to('cancelled', OrderEventType.Cancelled, { reasonId, by, role: isBuyer ? 'buyer' : 'seller' }, by);
  }

  /** System/admin cancellation (jobs, moderation) — bypasses buyer/seller ownership but still
   *  obeys the state machine (only cancellable states). */
  systemCancel(reason: string): void {
    if (!isCancellable(this.props.status)) throw new OrderForbiddenError(`Order cannot be cancelled in status ${this.props.status}`);
    this.props.cancelledBy = 'system';
    this.to('cancelled', OrderEventType.Cancelled, { reason, by: 'system', role: 'system' });
  }

  private assertSeller(by: string): void { if (this.props.sellerUserId !== by) throw new OrderForbiddenError('Only the seller may do this'); }
}
