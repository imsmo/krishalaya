// modules/orders/events/handlers/auction-won.handler.ts · PC-54 W54-6 `auction-settle`: the missing bridge.
// Consumes auctions.auction_won (outbox relay). The WINNING BID becomes a real order: source='auction',
// buyer = the winning bidder, ONE line at the hammer price for the WHOLE LOT (quantity 1 × amountMinor —
// an auction sells the lot, so the hammer price IS the line total; no client-side division, Law 2).
// Mirrors offer-accepted.handler: listing facts via ListingService (Law 11), IDEMPOTENT via orders.auction_id
// (0005 shipped the column awaiting this handler), atomic inside the relay tx.
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
import { DomainEvent } from '../../domain/orders.events';

function orderNo(id: string): string { return `KV${new Date().getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`; }

@Injectable()
export class AuctionWonHandler implements OutboxHandler {
  readonly eventType = 'auctions.auction_won';
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
    const auctionId = p.auctionId as string | undefined;
    const listingId = p.listingId as string | undefined;
    const bidderUserId = p.bidderUserId as string | undefined;
    const amountMinor = p.amountMinor as string | undefined;
    if (!tenantId || !auctionId || !listingId || !bidderUserId || !amountMinor || !/^\d+$/.test(amountMinor)) return; // malformed/legacy (pre-enrichment events lack bidderUserId) → ignore

    if (await this.repo.existsForAuction(tx, tenantId, auctionId)) return;              // idempotent (re-delivery)

    const l: any = await this.listings.getById(tenantId, listingId);                    // Law 11
    if (!l) return;
    const sellerUserId = l.sellerUserId as string;
    if (sellerUserId === bidderUserId) return;                                          // defensive: no self-deal

    const requiresPayment = await this.flags.isEnabled('online_payments', { tenantId, userId: bidderUserId });
    const now = new Date();
    const orderId = uuidv7();
    const item = OrderItem.of({
      id: uuidv7(), orderId, orderCreatedAt: now, tenantId, listingId, productId: l.productId,
      titleSnapshot: `${l.title} (auction lot)`, quantity: 1, unitCode: 'lot',
      unitPriceMinor: BigInt(amountMinor), gstRatePct: null, hsnCode: null, batchId: null,
    });
    const order = Order.place({
      id: orderId, tenantId, orderNo: orderNo(orderId), checkoutGroupId: null, buyerUserId: bidderUserId,
      sellerUserId, source: 'auction', currencyCode: l.currencyCode ?? 'INR', items: [item],
      deliveryMethodId: null, deliveryAddressId: null, requiresPayment, now,
    });
    await this.repo.insertGraph(tx, order, [item]);
    await this.repo.linkAuction(tx, tenantId, orderId, auctionId);                      // the idempotency anchor
    await this.flush(tx, tenantId, orderId, order.pullEvents());
    this.metrics.inc('orders.from_auction', { tenant: tenantId });
  }

  private async flush(tx: TxContext, tenantId: string, orderId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'order', aggregateId: orderId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
