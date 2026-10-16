// modules/auctions/events/auctions.publisher.ts
// Typed façade over the outbox writer for the auctions module's integration events. Every event is
// written INSIDE the caller's db transaction (Law 4) so the state change + event commit atomically.
// Payloads are versioned ({ v: 1, ... }) and carry NO PII (ids + minor-unit amounts as strings; a
// sealed-bid amount is never emitted). Consumers (notifications) are at-least-once + idempotent.
import { Inject, Injectable } from '@nestjs/common';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { TxContext } from '../../../core/database/unit-of-work';
import { AuctionEventType, DomainEvent } from '../domain/auctions.events';

@Injectable()
export class AuctionsPublisher {
  constructor(@Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter) {}

  /** Emit a batch of an auction aggregate's domain events, each in the caller's tx. */
  async publish(tx: TxContext, tenantId: string, auctionId: string, events: DomainEvent[]): Promise<void> {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'auction', aggregateId: auctionId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
  private async emit(tx: TxContext, tenantId: string, auctionId: string, type: AuctionEventType, payload: Record<string, unknown>): Promise<void> {
    await this.outbox.write(tx, { tenantId, aggregateType: 'auction', aggregateId: auctionId, eventType: type, payload: { v: 1, auctionId, ...payload } });
  }

  /** A higher bid arrived → notify the PREVIOUS high bidder they've been outbid. PC-56 STORE-3c · B9: + `lot_name` (the listing title — the
   *  variable `bid.outbid`'s template prints; seed 0007), never the new bidder. */
  outbid(tx: TxContext, tenantId: string, auctionId: string, previousBidderUserId: string, newAmountMinor: bigint, lotName: string | null = null) {
    return this.emit(tx, tenantId, auctionId, AuctionEventType.Outbid, { previousBidderUserId, newAmountMinor: newAmountMinor.toString(), ...(lotName ? { lot_name: lotName } : {}) });
  }
  /** A user started watching the auction (watch-list / analytics). */
  watchStarted(tx: TxContext, tenantId: string, auctionId: string, userId: string) {
    return this.emit(tx, tenantId, auctionId, AuctionEventType.WatchStarted, { userId });
  }
  /** An auction closed → notify everyone who WATCHED it. recipientUserIds travels in the payload (the notification
   *  bridge fans out one notification per recipient, deduped); carries NO PII beyond the in-tenant user ids. */
  watchersAuctionEnded(tx: TxContext, tenantId: string, auctionId: string, recipientUserIds: string[], hadWinner: boolean) {
    return this.emit(tx, tenantId, auctionId, AuctionEventType.WatchersEnded, { recipientUserIds, hadWinner });
  }
  /** A (losing) bidder's EMD hold was returned to their wallet. */
  emdReleased(tx: TxContext, tenantId: string, auctionId: string, bidderUserId: string, amountMinor: bigint) {
    return this.emit(tx, tenantId, auctionId, AuctionEventType.EmdReleased, { bidderUserId, amountMinor: amountMinor.toString() });
  }
}
