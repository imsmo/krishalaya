// modules/auctions/read-models/auction-live.read-model.ts
// Read-side (replica, CQRS): the bid stream for an auction, µs keyset (F-25). SEALED auctions hide other bidders' amounts
// until the auction has ended (a bidder always sees their OWN bids); open (english) auctions show every amount.
//
// PC-56 TENANT-11a · F-17 — "open prices, private people" (W138). Every row names its bidder as B1…Bn (entry order in THIS
// auction, stable — domain/display.ts); `bidderUserId` is the viewer's OWN id on their own rows and NULL on everyone
// else's, so raw ids never leave the API. AFTER the close the seller and the auction desk also see who each label is —
// the 1b phone mask and a short name — and the EMD each bidder held (per lot). Each row carries what the bid MEANS, all
// computed, none claimed: `reserveMet` (the bid against the reserve — true/false, or null while a sealed amount is hidden),
// `isHighest`, the per-unit amount and the lot value it implies. "Seller notified / push sent" is NOT annotated: this read
// does not join the notification log, and a badge nothing checked would be decoration.
import { Inject, Injectable } from '@nestjs/common';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { ListingService } from '../../listings/services/listing.service';
import { AuctionRepository } from '../repositories/auction.repository';
import { BidRepository } from '../repositories/bid.repository';
import { AuctionNotFoundError } from '../domain/auctions.errors';
import { bidderLabel, maskPhone, shortName } from '../domain/display';
import { Cursor, encodeCursor } from '../domain/cursor';
import { AuctionViewer } from '../services/auction.service';

const OPEN_STATES = ['scheduled', 'live', 'extended'];

@Injectable()
export class AuctionLiveReadModel {
  constructor(
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider,
    private readonly auctions: AuctionRepository,
    private readonly bids: BidRepository,
    private readonly listings: ListingService,
  ) {}

  async bidHistory(tenantId: string, viewer: AuctionViewer | string, auctionId: string, opts: { cursor?: Cursor; limit: number }) {
    const v: AuctionViewer = typeof viewer === 'string' ? { userId: viewer, isStaff: false } : viewer;
    const a = await this.auctions.getVisible(tenantId, auctionId);
    if (!a) throw new AuctionNotFoundError(auctionId);
    const p = a.toProps();
    const closed = !OPEN_STATES.includes(p.status);
    const sealedHidden = p.kind === 'sealed' && !closed;
    const l: any = await this.listings.getById(tenantId, p.listingId);
    const privileged = v.isStaff || l?.sellerUserId === v.userId;
    const revealPeople = privileged && closed;

    const order = await this.bids.biddersInOrder(tenantId, auctionId);
    const labelOf = new Map(order.map((b, i) => [b.bidderUserId, bidderLabel(i)]));
    const emdOf = new Map(order.map((b) => [b.bidderUserId, b.hasEmd ? a.emdForBid(b.firstAmountMinor) : 0n]));
    const people = revealPeople ? await this.people(tenantId, order.map((b) => b.bidderUserId)) : new Map<string, { phone: string | null; name: string | null }>();
    const high = sealedHidden ? null : (order.length ? (await this.bids.statsFor(tenantId, [auctionId])).get(auctionId)?.highMinor ?? null : null);

    const rows = await this.bids.listFor(tenantId, auctionId, opts);
    const items = rows.map((b) => {
      const mine = b.bidderUserId === v.userId;
      const amountVisible = !sealedHidden || mine;
      const amount = BigInt(b.amountMinor);
      const who = people.get(b.bidderUserId);
      return {
        id: b.id,
        bidderLabel: labelOf.get(b.bidderUserId) ?? 'B?',
        isMine: mine,
        bidderUserId: mine ? b.bidderUserId : null,                                   // never another person's id
        amountMinor: amountVisible ? b.amountMinor : null,                            // mask others' sealed bids
        lotValueMinor: amountVisible ? a.lotValue(amount).toString() : null,
        reserveMet: amountVisible ? a.reserveMetBy(amount) : null,
        isHighest: high !== null && amount === high && amountVisible,
        emdMinor: privileged ? (emdOf.get(b.bidderUserId) ?? 0n).toString() : null,
        bidderPhoneMasked: who?.phone ?? null,
        bidderShortName: who?.name ?? null,
        createdAt: b.createdAt,
      };
    });
    const last = rows[rows.length - 1];
    this.metrics.inc('auctions.bid_history', { tenant: tenantId });
    return {
      items,
      nextCursor: rows.length === opts.limit && last ? encodeCursor(last.createdAtRaw, last.id) : null,
      meta: { bidders: order.length, sealedHidden, identitiesRevealed: revealPeople, quantity: p.quantity, unitCode: p.unitCode },
    };
  }

  /** The seller's / desk's view of who bid, after close: the 1b phone mask + a short name. Never the full name or number. */
  private async people(tenantId: string, ids: string[]): Promise<Map<string, { phone: string | null; name: string | null }>> {
    const out = new Map<string, { phone: string | null; name: string | null }>();
    if (ids.length === 0) return out;
    const r = await this.replica.forTenant(tenantId).query<{ id: string; phone: string | null; full_name: string | null }>(
      `SELECT id, phone, full_name FROM users WHERE id = ANY($1::uuid[])`, [ids]);
    for (const u of r.rows) out.set(u.id, { phone: u.phone ? maskPhone(u.phone) : null, name: shortName(u.full_name) });
    return out;
  }
}
