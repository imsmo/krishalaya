// modules/orders/events/handlers/auction-won.handler.ts · PC-54 W54-6 `auction-settle`, re-cut by PC-56 TENANT-11a.
// Consumes auctions.auction_won (outbox relay).
//
// TENANT-11a (F-16, F-12): the order is now created INSIDE the auction's settlement transaction by
// `AuctionOrderService.createInTx` (status settled, settled_order_id set, EMD applied — one commit). So for every auction
// settled by this code the order already exists when this event is delivered, and the handler is a no-op (idempotent on
// `orders.auction_id`). It stays registered for ONE reason: an `auctions.auction_won` written BEFORE this wave may still be
// waiting in the outbox, and its auction has no order yet. Such an event carries no `quantity` — under the old meaning its
// `amountMinor` WAS the lot total — so it is honoured as exactly that (`1 × lot`), never re-read as a per-unit price; an
// event that carries `quantity` / `unitCode` (this wave's shape) is `quantity × unitPriceMinor` in the listing's unit.
import { Injectable } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { ListingService } from '../../../listings/services/listing.service';
import { AuctionOrderService } from '../../services/auction-order.service';

const QTY = /^\d{1,15}(\.\d{1,3})?$/;
function milli(q: string): bigint { const [w, f = ''] = q.split('.'); return BigInt(w) * 1000n + BigInt((f + '000').slice(0, 3)); }

@Injectable()
export class AuctionWonHandler implements OutboxHandler {
  readonly eventType = 'auctions.auction_won';
  constructor(private readonly listings: ListingService, private readonly auctionOrders: AuctionOrderService) {}

  async handle(event: OutboxEvent, tx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const p = event.payload as Record<string, unknown>;
    const auctionId = p.auctionId as string | undefined;
    const listingId = p.listingId as string | undefined;
    const bidderUserId = p.bidderUserId as string | undefined;
    const amountMinor = (p.unitPriceMinor ?? p.amountMinor) as string | undefined;
    if (!tenantId || !auctionId || !listingId || !bidderUserId || !amountMinor || !/^\d+$/.test(amountMinor)) return; // malformed/legacy (pre-enrichment events lack bidderUserId) → ignore

    const l: any = await this.listings.getById(tenantId, listingId);                    // Law 11
    if (!l) return;
    if (l.sellerUserId === bidderUserId) return;                                        // defensive: no self-deal

    const hasLot = typeof p.quantity === 'string' && QTY.test(p.quantity) && typeof p.unitCode === 'string' && p.unitCode.length > 0;
    const quantity = hasLot ? (p.quantity as string) : '1.000';
    const unitCode = hasLot ? (p.unitCode as string) : 'lot';
    const unit = BigInt(amountMinor);
    await this.auctionOrders.createInTx(tx, {
      tenantId, auctionId, listingId, productId: l.productId, title: l.title, currencyCode: l.currencyCode ?? 'INR',
      sellerUserId: l.sellerUserId, buyerUserId: bidderUserId, quantity, unitCode, unitPriceMinor: unit,
      expectedLotValueMinor: (unit * milli(quantity)) / 1000n,
    });
  }
}
