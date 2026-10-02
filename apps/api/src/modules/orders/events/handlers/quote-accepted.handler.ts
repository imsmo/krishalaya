// modules/orders/events/handlers/quote-accepted.handler.ts
// Consumes requirements.quote_accepted (delivered by the outbox relay). A buyer accepted a seller's quote on a requirement →
// create the order at the quoted per-unit price × the ACCEPTED quantity, source='requirement', requirement_id set.
//
// PC-56 TENANT-11d (founder decision: ONE ORDER PER MEMBER; F-11, F-27d). Before this wave the handler made ONE order per
// REQUIREMENT (idempotent on orders.requirement_id), so a requirement filled by two members' linked responses could only ever
// become one member's order; it took `quantity: Number(quantity)` and the LISTING's unit, so a buyer who asked in quintals could
// be ordered kilograms. Now:
//   • ONE ORDER PER ACCEPTED RESPONSE — the anchor is `requirement_responses.order_id` (written once, unique), claimed and
//     recorded through the requirements module's public RequirementOrderService (Law 11) in the SAME transaction as the order;
//   • the line is the response's ACCEPTED quantity (the DB's numeric text, proven to round-trip exactly into the order line's
//     number) in the REQUIREMENT's unit, at the quoted unit price; the seller is the response's member;
//   • it runs in kv_app's unit of work (RLS), as 10a / 11a's handlers do — never on the relay's kv_relay transaction, which holds
//     no grant on requirement_responses;
//   • a pre-11d event (no responseId) is honoured as before — one order per requirement, idempotent on orders.requirement_id.
// No money moves here: the order settles its own farmer directly, exactly as every order does.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OUTBOX_WRITER, OutboxWriter } from '../../../../core/outbox/outbox.writer';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext, UNIT_OF_WORK, UnitOfWork } from '../../../../core/database/unit-of-work';
import { FlagsService } from '../../../../core/feature-flags/flags.service';
import { uuidv7 } from '../../../../core/database/uuid.util';
import { Metrics, METRICS } from '../../../../core/observability/metrics';
import { ListingService } from '../../../listings/services/listing.service';
import { RequirementOrderService } from '../../../requirements/services/requirement-order.service';
import { exactQtyNumber } from '../../../requirements/domain/quantity';
import { OrderRepository } from '../../repositories/order.repository';
import { Order } from '../../domain/order.entity';
import { OrderItem } from '../../domain/order-item.entity';
import { DomainEvent } from '../../domain/orders.events';

function orderNo(id: string): string { return `KV${new Date().getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`; }

@Injectable()
export class QuoteAcceptedHandler implements OutboxHandler {
  readonly eventType = 'requirements.quote_accepted';
  private readonly log = new Logger(QuoteAcceptedHandler.name);
  constructor(
    private readonly repo: OrderRepository,
    private readonly listings: ListingService,
    private readonly flags: FlagsService,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly requirementOrders: RequirementOrderService,
  ) {}

  async handle(event: OutboxEvent, relayTx?: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const p = event.payload as Record<string, unknown>;
    if (!tenantId) return;
    const responseId = typeof p.responseId === 'string' ? p.responseId : null;
    if (!responseId) { if (relayTx) await this.legacy(tenantId, p, relayTx); return; }

    await this.uow.run(tenantId, async (tx) => {
      const a = await this.requirementOrders.claimForOrderInTx(tx, tenantId, responseId);
      if (!a) return;                                                                  // not accepted, or its order exists (re-delivery)
      if (a.sellerUserId === a.buyerUserId) { this.log.warn(`response ${responseId}: seller is the buyer — no order`); return; }
      const l: any = await this.listings.getById(tenantId, a.listingId);               // Law 11: product/title via the service
      if (!l) throw new Error(`listing ${a.listingId} of accepted response ${responseId} is gone — the relay retries, the order is not invented`);
      const requiresPayment = await this.flags.isEnabled('online_payments', { tenantId, userId: a.buyerUserId });
      const now = new Date();
      const orderId = uuidv7();
      const item = OrderItem.of({
        id: uuidv7(), orderId, orderCreatedAt: now, tenantId, listingId: a.listingId, productId: l.productId,
        titleSnapshot: l.title, quantity: exactQtyNumber(a.quantity), unitCode: a.unitCode,
        unitPriceMinor: a.unitPriceMinor, gstRatePct: null, hsnCode: null, batchId: null,
      });
      const order = Order.place({
        id: orderId, tenantId, orderNo: orderNo(orderId), checkoutGroupId: null, buyerUserId: a.buyerUserId,
        sellerUserId: a.sellerUserId, source: 'requirement', requirementId: a.requirementId, currencyCode: a.currencyCode || 'INR', items: [item],
        deliveryMethodId: null, deliveryAddressId: null, requiresPayment, now,
      });
      await this.repo.insertGraph(tx, order, [item]);
      await this.requirementOrders.attachOrderInTx(tx, tenantId, responseId, orderId);
      for (const e of order.pullEvents()) {
        await this.outbox.write(tx, { tenantId, aggregateType: 'order', aggregateId: orderId, eventType: e.type, payload: { v: 1, ...e.payload, requirementResponseId: responseId, requirementGroupId: a.groupId } });
      }
      this.metrics.inc('orders.from_requirement', { tenant: tenantId });
    }, { userId: 'system' });
  }

  /** A pre-11d event (no responseId): one order per requirement, idempotent on orders.requirement_id — honoured as it was. */
  private async legacy(tenantId: string, p: Record<string, unknown>, tx: TxContext): Promise<void> {
    const requirementId = p.requirementId as string | undefined;
    const buyerUserId = p.buyerUserId as string | undefined;
    const listingId = p.listingId as string | undefined;
    const quotedPriceMinor = p.quotedPriceMinor as string | undefined;
    const quantity = p.quantity as string | undefined;
    if (!requirementId || !buyerUserId || !listingId || !quotedPriceMinor || !quantity) return;  // malformed
    if (await this.repo.existsForRequirement(tx, tenantId, requirementId)) return;
    const l: any = await this.listings.getById(tenantId, listingId);
    if (!l || l.sellerUserId === buyerUserId) return;
    const requiresPayment = await this.flags.isEnabled('online_payments', { tenantId, userId: buyerUserId });
    const now = new Date();
    const orderId = uuidv7();
    const item = OrderItem.of({
      id: uuidv7(), orderId, orderCreatedAt: now, tenantId, listingId, productId: l.productId,
      titleSnapshot: l.title, quantity: exactQtyNumber(String(quantity)), unitCode: l.unitCode,
      unitPriceMinor: BigInt(quotedPriceMinor), gstRatePct: null, hsnCode: null, batchId: null,
    });
    const order = Order.place({
      id: orderId, tenantId, orderNo: orderNo(orderId), checkoutGroupId: null, buyerUserId,
      sellerUserId: l.sellerUserId, source: 'requirement', requirementId, currencyCode: l.currencyCode ?? 'INR', items: [item],
      deliveryMethodId: null, deliveryAddressId: null, requiresPayment, now,
    });
    await this.repo.insertGraph(tx, order, [item]);
    await this.flush(tx, tenantId, orderId, order.pullEvents());
    this.metrics.inc('orders.from_requirement', { tenant: tenantId });
  }

  private async flush(tx: TxContext, tenantId: string, orderId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'order', aggregateId: orderId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
