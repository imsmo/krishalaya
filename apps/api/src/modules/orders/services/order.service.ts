// modules/orders/services/order.service.ts
// Order lifecycle. Every transition: load with FOR UPDATE (partition-pruned), apply the entity
// method (which enforces the state machine + seller/buyer ownership), optimistic-locked update
// (version), timeline event + outbox events in the SAME tx, audit the actor's action.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { Order } from '../domain/order.entity';
import { DomainEvent } from '../domain/orders.events';
import { OrderNotFoundError, OrderConcurrencyError, OrderForbiddenError } from '../domain/orders.errors';
import { OrderRepository } from '../repositories/order.repository';
import { orderPaymentState, OrderPaymentFacts } from '../domain/order-payment-state';
import { QUALITY_WINDOW_REASON, QUALITY_WINDOW_REQUIRES_ONLINE_PAYMENT, SELLER_CONFIRM_TIMEOUT_REASON, qualityWindowDue, sellerConfirmTimeoutDue } from '../domain/order-clocks';
import { OrderViewerRole, viewerRoleOf } from '../domain/order-event-roles';

export interface OrderActor { userId: string; canModerate: boolean; }

@Injectable()
export class OrderService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: OrderRepository,
  ) {}

  private async transition(tenantId: string, actor: OrderActor, id: string, action: string, mutate: (o: Order) => void, opts: { auditIp?: string | null; preCheck?: (o: Order) => void } = {}) {
    await timed(this.metrics, `orders.${action}`, { tenant: tenantId }, async () => {
      await this.uow.run(tenantId, async (tx) => {
        const order = await this.repo.getForUpdate(tx, tenantId, id);
        if (!order) throw new OrderNotFoundError(id);
        opts.preCheck?.(order);
        const from = order.status;
        mutate(order);
        const ok = await this.repo.update(tx, order, from, actor.userId);   // HOTFIX-5 · B3: the hop records who made it
        if (!ok) throw new OrderConcurrencyError(id);
        await this.flush(tx, tenantId, id, order.pullEvents());
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: `order.${action}`, entityType: 'order', entityId: id, oldValue: { status: from }, newValue: { status: order.status }, ip: opts.auditIp ?? null });
      }, { userId: actor.userId });
    });
  }

  confirm(t: string, a: OrderActor, id: string, ip: string | null) { return this.transition(t, a, id, 'confirmed', (o) => o.confirm(a.userId), { auditIp: ip }); }
  markPacked(t: string, a: OrderActor, id: string, ip: string | null) { return this.transition(t, a, id, 'packed', (o) => o.markPacked(a.userId), { auditIp: ip }); }
  markReady(t: string, a: OrderActor, id: string, ip: string | null) { return this.transition(t, a, id, 'ready', (o) => o.markReady(a.userId), { auditIp: ip }); }
  markDelivered(t: string, a: OrderActor, id: string, ip: string | null) { return this.transition(t, a, id, 'delivered', (o) => o.markDelivered(a.userId), { auditIp: ip }); }
  dispute(t: string, a: OrderActor, id: string, note: string | undefined, ip: string | null) { return this.transition(t, a, id, 'disputed', (o) => o.dispute(a.userId, note), { auditIp: ip }); }
  cancel(t: string, a: OrderActor, id: string, reasonId: string | null, ip: string | null) {
    return this.transition(t, a, id, 'cancelled', (o) => o.cancel(a.userId, reasonId, o.buyerUserId === a.userId), { auditIp: ip });
  }
  /** Completion: only the buyer (receipt confirmation) or a moderator. */
  complete(t: string, a: OrderActor, id: string, ip: string | null) {
    return this.transition(t, a, id, 'completed', (o) => o.complete(), {
      auditIp: ip, preCheck: (o) => { if (!a.canModerate && o.buyerUserId !== a.userId) throw new OrderForbiddenError('Only the buyer may complete the order'); },
    });
  }

  /* ------------------------------------------------------------------------------------------------------------------------------ */
  /* PC-56 HOTFIX-5 · B1 (founder D2) — THE TWO ORDER CLOCKS' ACTS. Each runs in its OWN kv_app transaction, re-locks the row, re-checks */
  /* the clock's rule on it (domain/order-clocks.ts) and returns false when there is nothing to do — so a second tick, or a row claimed  */
  /* by two ticks, changes nothing: the state machine and the rule refuse, the version guard catches a racing write.                    */
  /* ------------------------------------------------------------------------------------------------------------------------------ */

  /** The 24 h seller-confirm timeout: a `created` / `payment_pending` order (never an auction's) past its acceptance deadline is cancelled
   *  by the SYSTEM. `orders.order_cancelled` carries the 2c payload (`stockReserved`, buyer, seller, total, currency, role `system`), so the
   *  restock (orders) and the refund-to-source (payments) handlers fire exactly as they do for a buyer's cancel. Audited, no person. */
  async timeoutCancel(tenantId: string, id: string, now: Date = new Date()): Promise<boolean> {
    return this.uow.run(tenantId, async (tx) => {
      const order = await this.repo.getForUpdate(tx, tenantId, id);
      if (!order) return false;
      const p = order.toProps();
      if (!sellerConfirmTimeoutDue(p, now)) return false;
      const from = order.status;
      order.systemCancel(SELLER_CONFIRM_TIMEOUT_REASON);
      if (!(await this.repo.update(tx, order, from))) throw new OrderConcurrencyError(id);
      await this.flush(tx, tenantId, id, order.pullEvents(), { reason: SELLER_CONFIRM_TIMEOUT_REASON });
      await this.audit.write(tx, { tenantId, actorUserId: null, action: 'order.auto_cancelled', entityType: 'order', entityId: id, ip: null,
        reason: 'the seller did not confirm within the acceptance window — the order was cancelled by the system',
        oldValue: { status: from, acceptanceDeadline: p.acceptanceDeadline }, newValue: { status: 'cancelled', stockReserved: !!p.stockReservedAt } });
      return true;
    }, { userId: 'system' });
  }

  /** The quality-window auto-complete: a `delivered` order past `quality_window_ends` — PAID ONLINE into escrow (QUALITY_WINDOW_REQUIRES_ONLINE_PAYMENT) —
   *  completes as the SYSTEM. `Order.complete` emits
   *  `orders.order_completed` with the same settlement payload a buyer's receipt or a moderator's completion emits — the payments module's
   *  OrderCompletedHandler → OrderSettlementService.settle releases escrow under `settle:<orderId>` (one path, one key). Audited. */
  async autoComplete(tenantId: string, id: string, now: Date = new Date()): Promise<boolean> {
    return this.uow.run(tenantId, async (tx) => {
      const order = await this.repo.getForUpdate(tx, tenantId, id);
      if (!order) return false;
      const p = order.toProps();
      if (!qualityWindowDue(p, now)) return false;
      // fail closed: only an order whose money reached escrow by an online capture (domain/order-clocks.ts — a pay-on-delivery order's
      // completion would credit the seller from an escrow that never held it)
      if (QUALITY_WINDOW_REQUIRES_ONLINE_PAYMENT && !(await this.repo.placedAwaitingPaymentTx(tx, tenantId, id))) return false;
      const from = order.status;
      order.complete(now);
      if (!(await this.repo.update(tx, order, from, 'system'))) throw new OrderConcurrencyError(id);
      await this.flush(tx, tenantId, id, order.pullEvents(), { reason: QUALITY_WINDOW_REASON });
      await this.audit.write(tx, { tenantId, actorUserId: null, action: 'order.auto_completed', entityType: 'order', entityId: id, ip: null,
        reason: 'the quality window closed with no dispute — the order was completed by the system and its escrow released to the seller',
        oldValue: { status: from, qualityWindowEnds: p.qualityWindowEnds }, newValue: { status: 'completed', totalMinor: p.totalMinor.toString(), currencyCode: p.currencyCode } });
      return true;
    }, { userId: 'system' });
  }

  /** PC-56 HOTFIX-5 · B3 — who is reading this order, for the reads that answer differently by role (the buyer never receives a person's
   *  id or name). 404s a stranger exactly like `getById`. */
  async viewerOf(tenantId: string, actor: OrderActor, id: string): Promise<{ role: OrderViewerRole; createdAt: Date; buyerUserId: string; sellerUserId: string }> {
    const order = await this.repo.getVisible(tenantId, id, actor.userId, actor.canModerate);
    if (!order) throw new OrderNotFoundError(id);
    const p = order.toProps();
    return { role: viewerRoleOf(actor, p), createdAt: new Date(p.createdAt), buyerUserId: p.buyerUserId, sellerUserId: p.sellerUserId };
  }

  async getById(tenantId: string, actor: OrderActor, id: string) {
    const order = await this.repo.getVisible(tenantId, id, actor.userId, actor.canModerate);
    if (!order) throw new OrderNotFoundError(id);
    const p = order.toProps();
    const role = viewerRoleOf(actor, p);
    const [items, facts, organisation] = await Promise.all([this.repo.itemsOf(tenantId, id), this.repo.paymentFacts(tenantId, id), this.repo.organisationOf(tenantId)]);
    const all = this.serialize(p, facts);
    // PC-56 HOTFIX-5 · B3 (HOTFIX-4 D3, survey F-7): the BUYER's view names the ORGANISATION, never a person's id — the seller console and
    // moderation keep both parties (the HOTFIX-4 owner / non-owner precedent).
    if (role === 'buyer') { const { buyerUserId: _b, sellerUserId: _s, ...safe } = all; void _b; void _s; return { ...safe, organisation, items }; }
    return { ...all, organisation, items };
  }

  /**
   * **THE GATE W226 PRINTS AS A RULE AND NOTHING ENFORCED (PC-56 TENANT-5a).**
   *
   * W226, in the copy under its own table: *"A shipment for a `payment_pending` order stays `pending` —
   * wheels never turn before money clears (the cumin row shows exactly this)."* `ShipmentService` never read
   * the order — not on create, not on assign, not on schedule-pickup, not on pickup — so a shipment against
   * an unpaid order could be assigned a driver, collected from a farmer's gate and delivered, and every step
   * would have succeeded.
   *
   * This is the ORDERS module's answer to that question, because the order's payment state is the orders
   * module's fact. Logistics calls this public method inside its own transaction (module blueprint: another
   * module's PUBLIC SERVICE, never its repositories) and applies the verdict; the vocabulary of the verdict
   * lives in `logistics/domain/shipment-readiness.ts` so the console can render the reason.
   *
   * Returns null when the order cannot be seen at all — the caller must refuse rather than assume.
   */
  async transportStatus(tx: TxContext, tenantId: string, orderId: string): Promise<string | null> {
    return this.repo.statusOf(tx, tenantId, orderId);
  }

  /** PC-56 TENANT-SW-a · B2 — orders placed per delivery zone in the last N days (W233 "Orders 30d"; the zone is frozen at placement). */
  ordersByZoneSince(tenantId: string, zoneIds: string[], days: number): Promise<Map<string, number>> {
    return this.repo.countByZoneSince(tenantId, zoneIds, days);
  }
  /** PC-56 TENANT-SW-a · D1 / C1 — the order's parties and money facts, read in the caller's transaction (POD review, COD shortfall). */
  partiesInTx(tx: TxContext, tenantId: string, orderId: string) { return this.repo.pricingFactsTx(tx, tenantId, orderId); }

  /** PC-56 HOTFIX-4 · A1/A2 (survey F-1, F-5d, C-11): + `paymentState` (the ORDER's own answer to "has the buyer paid?" — never a payment
   *  vocabulary guessed by a client) and the two buyer-side charges that were inside `totalMinor` but nowhere else, so the rows a buyer
   *  reads sum to the total: subtotal + delivery + tax − discount + platformFee + buyerCommission = total. Existing fields unchanged. */
  private serialize(p: ReturnType<Order['toProps']>, facts: OrderPaymentFacts) {
    return { id: p.id, orderNo: p.orderNo, status: p.status, paymentState: orderPaymentState(p.status, facts), source: p.source, buyerUserId: p.buyerUserId, sellerUserId: p.sellerUserId,
      currencyCode: p.currencyCode, subtotalMinor: p.subtotalMinor.toString(), deliveryFeeMinor: p.deliveryFeeMinor.toString(),
      discountMinor: p.discountMinor.toString(), taxMinor: p.taxMinor.toString(), commissionMinor: p.commissionMinor.toString(),
      platformFeeMinor: p.platformFeeMinor.toString(), buyerCommissionMinor: (p.buyerCommissionMinor ?? 0n).toString(),
      totalMinor: p.totalMinor.toString(), acceptanceDeadline: p.acceptanceDeadline, qualityWindowEnds: p.qualityWindowEnds,
      checkoutGroupId: p.checkoutGroupId, createdAt: p.createdAt, completedAt: p.completedAt };
  }

  private async flush(tx: TxContext, tenantId: string, orderId: string, events: DomainEvent[], extra: Record<string, unknown> = {}) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'order', aggregateId: orderId, eventType: e.type, payload: { v: 1, ...extra, ...e.payload } });
  }
}
