// modules/auctions/services/bid.service.ts
// The bid hot path. In ONE tx: lock the auction row (FOR UPDATE — serializes concurrent bids),
// enforce the rules (not the seller, not already high bidder, ≥ min next bid), HOLD the EMD via the
// wallet boundary (once per bidder per auction; the wallet enforces no-overdraw → anti-spam), append
// the IMMUTABLE bid, apply anti-snipe auto-extend, and emit outbox events — all atomic. Idempotent
// on the caller's Idempotency-Key (Law 3). Gated by the `auctions` feature flag at the controller.
//
// PC-56 TENANT-11a: bids are PER UNIT (F-12) — the EMD stays per lot (flat, or % of the LOT value of the first bid); a bid
// at or after `ends_at` is refused AUCTION_ENDED and anti-snipe only extends inside the live window (F-15); while entry is
// paused a user with no prior bid in this auction is refused AUCTION_ENTRY_PAUSED, existing bidders continue (A11).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { WALLET_SERVICE, WalletPort } from '../../../core/wallet/wallet.port';
import { userMain, userHold } from '../../../core/wallet/account-codes';
import { uuidv7 } from '../../../core/database/uuid.util';
import { ListingService } from '../../listings/services/listing.service';
import { Bid } from '../domain/bid.entity';
import { DomainEvent, AuctionEventType } from '../domain/auctions.events';
import { AuctionNotFoundError, SellerCannotBidError, AlreadyHighBidderError, AuctionEntryPausedError } from '../domain/auctions.errors';
import { emdHoldKey } from '../domain/lot';
import { AuctionRepository } from '../repositories/auction.repository';
import { BidRepository } from '../repositories/bid.repository';
import { AuctionsPublisher } from '../events/auctions.publisher';

@Injectable()
export class BidService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly listings: ListingService,
    private readonly auctions: AuctionRepository,
    private readonly bids: BidRepository,
    private readonly publisher: AuctionsPublisher,
  ) {}

  async placeBid(tenantId: string, bidderUserId: string, auctionId: string, idemKey: string, amountMinorStr: string, ip: string | null) {
    const amountMinor = BigInt(amountMinorStr);
    return this.idem.remember(idemKey, bidderUserId, 'auctions.bid', () =>
      timed(this.metrics, 'auctions.bid', { tenant: tenantId }, async () =>
        this.uow.run(tenantId, async (tx) => {
          const a = await this.auctions.getForUpdate(tx, tenantId, auctionId);   // lock — serialize bids
          if (!a) throw new AuctionNotFoundError(auctionId);

          // the listing's seller cannot bid on their own auction (anti self-deal)
          const l: any = await this.listings.getById(tenantId, a.listingId);
          if (l && l.sellerUserId === bidderUserId) throw new SellerCannotBidError();

          const now = new Date();
          const sealed = a.toProps().kind === 'sealed';
          const high = await this.bids.highest(tx, tenantId, auctionId);
          if (!sealed && high && high.bidderUserId === bidderUserId) throw new AlreadyHighBidderError();
          a.assertBidAcceptable(amountMinor, sealed ? null : (high?.amountMinor ?? null), now);   // throws BidTooLow / NotBiddable / AuctionEnded
          if (a.toProps().entryPaused && !(await this.bids.hasBid(tx, tenantId, auctionId, bidderUserId))) throw new AuctionEntryPausedError();

          // EMD: hold once per (auction, bidder); reuse the existing hold on subsequent bids
          let emdTxnId = await this.bids.existingEmdTxn(tx, tenantId, auctionId, bidderUserId);
          if (!emdTxnId) {
            const emd = a.emdForBid(amountMinor);
            if (emd > 0n) {
              const txn = await this.wallet.post(tx, { tenantId, txnType: 'emd_hold', idempotencyKey: emdHoldKey(auctionId, bidderUserId), referenceType: 'auction', referenceId: auctionId, initiatedBy: bidderUserId,
                legs: [ { account: userMain(bidderUserId), amountMinor: -emd }, { account: userHold(bidderUserId), amountMinor: emd } ] });
              emdTxnId = txn.txnId;
            }
          }

          const bidId = uuidv7();
          await this.bids.insert(tx, Bid.place({ id: bidId, tenantId, auctionId, bidderUserId, amountMinor, isSealed: sealed, emdTxnId, ip }));

          const extended = a.maybeExtend(now);
          if (extended) { if (!(await this.auctions.update(tx, a))) { /* version moved under our lock — impossible; ignore */ } await this.auctions.recordEvent(tx, tenantId, auctionId, 'extended', { endsAt: a.endsAt.toISOString() }); }

          const events: DomainEvent[] = [{ type: AuctionEventType.BidPlaced, payload: { auctionId, bidId, bidderUserId, amountMinor: sealed ? 'sealed' : amountMinor.toString() } }, ...a.pullEvents()];
          for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'auction', aggregateId: auctionId, eventType: e.type, payload: { v: 1, ...e.payload } });
          // open-auction outbid: a strictly-higher bid displaced the previous high bidder → notify them
          if (!sealed && high && high.bidderUserId !== bidderUserId && amountMinor > high.amountMinor) {
            await this.publisher.outbid(tx, tenantId, auctionId, high.bidderUserId, amountMinor);
          }
          this.metrics.inc('auctions.bid_placed', { tenant: tenantId, extended: String(extended) });
          return { bidId, auctionId, amountMinor: amountMinorStr, lotValueMinor: a.lotValue(amountMinor).toString(), quantity: a.quantity, unitCode: a.toProps().unitCode, extended, endsAt: a.endsAt };
        }, { userId: bidderUserId })));
  }
}
