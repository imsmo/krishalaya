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
        const ok = await this.repo.update(tx, order, from);
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

  async getById(tenantId: string, actor: OrderActor, id: string) {
    const order = await this.repo.getVisible(tenantId, id, actor.userId, actor.canModerate);
    if (!order) throw new OrderNotFoundError(id);
    const items = await this.repo.itemsOf(tenantId, id);
    const p = order.toProps();
    return { ...this.serialize(p), items };
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

  private serialize(p: ReturnType<Order['toProps']>) {
    return { id: p.id, orderNo: p.orderNo, status: p.status, source: p.source, buyerUserId: p.buyerUserId, sellerUserId: p.sellerUserId,
      currencyCode: p.currencyCode, subtotalMinor: p.subtotalMinor.toString(), deliveryFeeMinor: p.deliveryFeeMinor.toString(),
      discountMinor: p.discountMinor.toString(), taxMinor: p.taxMinor.toString(), commissionMinor: p.commissionMinor.toString(),
      totalMinor: p.totalMinor.toString(), acceptanceDeadline: p.acceptanceDeadline, qualityWindowEnds: p.qualityWindowEnds,
      createdAt: p.createdAt, completedAt: p.completedAt };
  }

  private async flush(tx: TxContext, tenantId: string, orderId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'order', aggregateId: orderId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
