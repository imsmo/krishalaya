// modules/auctions/read-models/auction-public.read-model.ts · PC-56 STORE-2c · B7 (survey C-3 / B27 / F-23, founder 2a D1) — THE AUCTION AS A
// BUYER MAY SEE IT, WITHOUT A SESSION.
//
// What was true: the storefront's auction page called `GET /v1/auctions/:id` and the bid list anonymously — both are AuthGuard routes, so the
// page ALWAYS said "couldn't load"; it printed the RESERVE AMOUNT, and it computed the minimum next bid and the lot total in the browser.
// What this read returns (every figure computed HERE, by the auction aggregate's own rules — none in a client):
//   • the lot — title, the ORGANISATION (slug + name, never a person), unit, quantity, district name;
//   • `reserveMet` — a BOOLEAN only (founder 2a D1: never the reserve amount);
//   • `currentBidMinor` (per unit; null with no bids, or while a sealed auction hides amounts), `minNextBidMinor` (Auction.minNextBidMinor),
//     `lotTotalMinor` (quantity × the current bid, the order line's floor) and `minNextLotTotalMinor`;
//   • `endsAt` + the server's anti-snipe rule (`antiSnipe.triggerSec` / `extendSec` — the auction's own columns, never a literal);
//   • the bid history as `{at, amountMinor}` — NO bidder identity of any kind (no label, no mask, no city: founder 2a D1);
//   • the EMD rule as the API holds it (`emd.flatMinor` or `emd.pctBps` of the lot value) and `balanceDueHours` (domain/lot.ts BALANCE_DUE_MS);
//   • `currencyCode` (the lot's listing) + its `exponent` (`currencies.minor_units`), so a typed bid is parsed with the right decimals;
//   • for a SIGNED-IN viewer of THIS organisation only: their best bid, whether it leads, and — once settled — whether they won and the
//     order the settlement created (never anyone else's).
// Behind the `auctions` flag (the controller's FeatureFlagGuard — OFF answers 404). A suspended seller's auction is not public (the listing
// rule). Replica reads, bounded (20 bids).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { ListingService } from '../../listings/services/listing.service';
import { AuctionRepository } from '../repositories/auction.repository';
import { BidRepository } from '../repositories/bid.repository';
import { AuctionNotFoundError } from '../domain/auctions.errors';
import { BALANCE_DUE_MS } from '../domain/lot';

const OPEN_STATES = ['scheduled', 'live', 'extended'];
/** Bounded history (Law 11): the newest bids only. */
export const PUBLIC_BID_HISTORY_LIMIT = 20;
/** The statuses a buyer can see (a draft-like state never leaks: an unknown status is 404). */
const PUBLIC_STATES = ['scheduled', 'live', 'extended', 'ended', 'awaiting_approval', 'settled', 'failed_reserve', 'cancelled', 'defaulted'];

export interface PublicAuctionView {
  auctionId: string; auctionNo: string | null; status: string; kind: string; isOpen: boolean;
  lot: { title: string; unitCode: string; quantity: string; organisation: { slug: string; name: string } | null; district: string | null };
  currencyCode: string; exponent: number | null;
  reserveMet: boolean; hasBids: boolean; bidCount: number; sealedHidden: boolean;
  currentBidMinor: string | null; lotTotalMinor: string | null; minNextBidMinor: string; minNextLotTotalMinor: string;
  startsAt: string; endsAt: string; antiSnipe: { triggerSec: number; extendSec: number };
  emd: { flatMinor: string | null; pctBps: number | null };
  balanceDueHours: number;
  bids: Array<{ at: string; amountMinor: string | null }>;
  viewer: { bestBidMinor: string | null; leading: boolean; won: boolean; orderId: string | null } | null;
}

@Injectable()
export class AuctionPublicReadModel {
  constructor(
    @Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider,
    private readonly auctions: AuctionRepository,
    private readonly bids: BidRepository,
    private readonly listings: ListingService,
  ) {}

  async view(tenantId: string, auctionId: string, viewerUserId: string | null): Promise<PublicAuctionView> {
    if (!/^[0-9a-fA-F-]{36}$/.test(auctionId)) throw new AuctionNotFoundError(auctionId);
    const a = await this.auctions.getVisible(tenantId, auctionId);
    if (!a) throw new AuctionNotFoundError(auctionId);
    const p = a.toProps();
    if (!PUBLIC_STATES.includes(p.status)) throw new AuctionNotFoundError(auctionId);
    const lot = await this.listings.auctionLotFacts(tenantId, p.listingId);
    if (!lot || lot.sellerSuspended) throw new AuctionNotFoundError(auctionId);   // a suspended seller's lot is not public (the listing rule)

    const isOpen = OPEN_STATES.includes(p.status);
    const sealedHidden = p.kind === 'sealed' && isOpen;
    const stats = (await this.bids.statsFor(tenantId, [auctionId])).get(auctionId) ?? { highMinor: null, bidders: 0 };
    const high = stats.highMinor;
    const visibleHigh = sealedHidden ? null : high;
    const minNext = a.minNextBidMinor(sealedHidden ? null : high);
    const rows = await this.bids.listFor(tenantId, auctionId, { limit: PUBLIC_BID_HISTORY_LIMIT });
    const count = await this.replica.forTenant(tenantId).query<{ n: number }>(`SELECT count(*)::int AS n FROM bids WHERE tenant_id=$1 AND auction_id=$2`, [tenantId, auctionId]);
    const cur = await this.replica.forTenant(tenantId).query<{ minor_units: number }>(`SELECT minor_units FROM currencies WHERE code=$1`, [lot.currencyCode]);

    let viewer: PublicAuctionView['viewer'] = null;
    if (viewerUserId) {
      const mine = await this.replica.forTenant(tenantId).query<{ best: string | null }>(
        `SELECT max(amount_minor)::text AS best FROM bids WHERE tenant_id=$1 AND auction_id=$2 AND bidder_user_id=$3`, [tenantId, auctionId, viewerUserId]);
      const best = mine.rows[0]?.best ?? null;
      let won = false;
      if (p.winningBidId && (p.status === 'settled' || p.status === 'defaulted')) {
        const w = await this.replica.forTenant(tenantId).query<{ bidder_user_id: string }>(`SELECT bidder_user_id FROM bids WHERE tenant_id=$1 AND id=$2`, [tenantId, p.winningBidId]);
        won = w.rows[0]?.bidder_user_id === viewerUserId;
      }
      viewer = { bestBidMinor: best, leading: !sealedHidden && best !== null && high !== null && BigInt(best) === high && isOpen,
        won, orderId: won ? p.settledOrderId : null };
    }

    return {
      auctionId: p.id, auctionNo: p.auctionNo, status: p.status, kind: p.kind, isOpen,
      lot: { title: lot.title, unitCode: p.unitCode, quantity: p.quantity, organisation: lot.organisation, district: lot.district },
      currencyCode: lot.currencyCode, exponent: cur.rows[0] ? Number(cur.rows[0].minor_units) : null,
      // founder 2a D1: met / not met ONLY — the amount never leaves this read. No bid yet → not met. A sealed auction's high is hidden while
      // open, so "met" is not said for it either until it closes.
      reserveMet: visibleHigh !== null && a.reserveMetBy(visibleHigh) === true,
      hasBids: stats.bidders > 0, bidCount: Number(count.rows[0]?.n ?? 0), sealedHidden,
      currentBidMinor: visibleHigh !== null ? visibleHigh.toString() : null,
      lotTotalMinor: visibleHigh !== null ? a.lotValue(visibleHigh).toString() : null,
      minNextBidMinor: minNext.toString(), minNextLotTotalMinor: a.lotValue(minNext).toString(),
      startsAt: p.startsAt.toISOString(), endsAt: p.endsAt.toISOString(),
      antiSnipe: { triggerSec: p.extendTriggerSecs, extendSec: p.autoExtendSecs },
      emd: { flatMinor: p.emdMinor > 0n ? p.emdMinor.toString() : null, pctBps: p.emdMinor > 0n ? null : (p.emdPctBps ?? null) },
      balanceDueHours: BALANCE_DUE_MS / 3_600_000,
      // NO bidder identity: the time and (unless sealed and open) the amount — nothing else
      bids: rows.map((b) => ({ at: new Date(b.createdAt).toISOString(), amountMinor: sealedHidden ? null : b.amountMinor })),
      viewer,
    };
  }
}
