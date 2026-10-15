// modules/orders/events/handlers/offer-accepted.handler.ts
// Consumes offers.offer_accepted (delivered by the outbox relay). A buyer↔seller negotiation that
// was ACCEPTED becomes a real order at the agreed per-unit price × quantity, source='offer'. Runs
// INSIDE the relay tx (the order insert + the link-back event commit atomically). Cross-module rule:
// the seller/product/title come from ListingService (Law 11 — never the listings repo); we touch only
// the orders module's own repository here. IDEMPOTENT: if an order already exists for this offer (its
// offer_id), we no-op — so at-least-once re-delivery never double-creates an order.
import { Inject, Injectable } from '@nestjs/common';
import { OUTBOX_WRITER, OutboxWriter } from '../../../../core/outbox/outbox.writer';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { FlagsService } from '../../../../core/feature-flags/flags.service';
import { uuidv7 } from '../../../../core/database/uuid.util';
import { Metrics, METRICS } from '../../../../core/observability/metrics';
import { ListingService } from '../../../listings/services/listing.service';
import { OrderRepository } from '../../repositories/order.repository';
import { Order } from '../../domain/order.entity';
import { OrderItem } from '../../domain/order-item.entity';
import { OrderEventType, DomainEvent } from '../../domain/orders.events';

// PC-56 HOTFIX-5 · B2: the order number is the ONE helper's (random bits); B4: the currency is the listing's (Rule Zero)
import { orderNoFor } from '../../domain/order-no';
import { currencyFromListing } from '../../domain/order-currency';

@Injectable()
export class OfferAcceptedHandler implements OutboxHandler {
  readonly eventType = 'offers.offer_accepted';
  constructor(
    private readonly repo: OrderRepository,
    private readonly listings: ListingService,
    private readonly flags: FlagsService,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  async handle(event: OutboxEvent, tx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const p = event.payload as Record<string, unknown>;
    const offerId = p.offerId as string | undefined;
    const listingId = p.listingId as string | undefined;
    const buyerUserId = p.buyerUserId as string | undefined;
    const agreedPriceMinor = p.agreedPriceMinor as string | undefined;
    const quantity = p.quantity as string | undefined;
    if (!tenantId || !offerId || !listingId || !buyerUserId || !agreedPriceMinor || !quantity) return;  // malformed → ignore

    if (await this.repo.existsForOffer(tx, tenantId, offerId)) return;                  // idempotent (re-delivery)

    const l: any = await this.listings.getById(tenantId, listingId);                    // Law 11: seller/product via the service
    if (!l) return;                                                                     // listing vanished — cannot snapshot; offer stays accepted
    const sellerUserId = l.sellerUserId as string;
    if (sellerUserId === buyerUserId) return;                                           // defensive: offers already forbids self-deal

    const requiresPayment = await this.flags.isEnabled('online_payments', { tenantId, userId: buyerUserId });
    const now = new Date();
    const orderId = uuidv7();
    const item = OrderItem.of({
      id: uuidv7(), orderId, orderCreatedAt: now, tenantId, listingId, productId: l.productId,
      titleSnapshot: l.title, quantity: Number(quantity), unitCode: l.unitCode,
      unitPriceMinor: BigInt(agreedPriceMinor), gstRatePct: null, hsnCode: null, batchId: null,
    });
    const order = Order.place({
      id: orderId, tenantId, orderNo: orderNoFor(orderId, now), checkoutGroupId: null, buyerUserId,
      sellerUserId, source: 'offer', offerId, currencyCode: currencyFromListing(l.currencyCode, 'offer', offerId), items: [item],
      deliveryMethodId: null, deliveryAddressId: null, requiresPayment, now,
    });
    await this.repo.insertGraph(tx, order, [item]);
    await this.flush(tx, tenantId, orderId, order.pullEvents());                        // order_created (+ payment_required)
    // link-back event → the offers module marks the offer converted (sets converted_order_id)
    await this.outbox.write(tx, { tenantId, aggregateType: 'order', aggregateId: orderId, eventType: OrderEventType.FromOfferCreated, payload: { v: 1, orderId, offerId } });
    this.metrics.inc('orders.from_offer', { tenant: tenantId });
  }

  private async flush(tx: TxContext, tenantId: string, orderId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'order', aggregateId: orderId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
