// @krishalaya/sdk-js · auctions resource (module 3). Browse/detail are public-within-tenant; create is
// seller-only; approve/cancel are seller-or-moderator (server-enforced). Placing a bid holds an EMD (earnest-money
// deposit) on the bidder's WALLET — entirely SERVER-SIDE (the client never moves money, Law 11); on loss the EMD
// is refunded server-side. create + placeBid carry an Idempotency-Key (Law 3) — a retried bid can't double-hold.
// Money is bigint minor-unit strings (Law 2). Gated server-side by the `auctions` flag.
import { HttpClient } from '../http';
import { Auction, BidHistoryItem, PlaceBidResult, MyBid, WatchedAuction, Page } from '../types';

export class AuctionsResource {
  constructor(private readonly http: HttpClient) {}

  /** Browse auctions (optionally by status: live/ended/…). Keyset. */
  async list(params: { status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<Auction>> {
    const r = await this.http.request<Auction[]>('GET', 'auctions', { query: { status: params.status, cursor: params.cursor, limit: params.limit ?? 20 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async get(id: string, signal?: AbortSignal): Promise<Auction> {
    return (await this.http.request<Auction>('GET', `auctions/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Create an auction on a listing the caller owns. Idempotent. Money fields are bigint minor strings (Law 2). */
  async create(input: {
    listingId: string; kind?: 'english_open' | 'sealed'; startPriceMinor: string; reservePriceMinor?: string;
    minIncrementMinor?: string; emdMinor?: string; emdPctBps?: number; startsAt: string; endsAt: string;
    autoExtendSecs?: number; extendTriggerSecs?: number; minBidders?: number; requiresSellerApproval?: boolean;
  }, idempotencyKey: string): Promise<Auction> {
    return (await this.http.request<Auction>('POST', 'auctions', { idempotencyKey, body: input })).data;
  }
  approve(id: string): Promise<{ ok: boolean }> { return this.http.request<{ ok: boolean }>('POST', `auctions/${encodeURIComponent(id)}/approve`, { body: {} }).then((r) => r.data); }
  cancel(id: string): Promise<{ ok: boolean }> { return this.http.request<{ ok: boolean }>('POST', `auctions/${encodeURIComponent(id)}/cancel`, { body: {} }).then((r) => r.data); }

  /** Place a bid (amount in minor units). Holds the EMD server-side. Idempotent. */
  async placeBid(auctionId: string, amountMinor: string, idempotencyKey: string): Promise<PlaceBidResult> {
    return (await this.http.request<PlaceBidResult>('POST', `auctions/${encodeURIComponent(auctionId)}/bids`, { idempotencyKey, body: { amountMinor } })).data;
  }
  /** Bid history (newest-first, keyset). Sealed auctions mask others' amounts until close (server-side). */
  async listBids(auctionId: string, params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<BidHistoryItem>> {
    const r = await this.http.request<BidHistoryItem[]>('GET', `auctions/${encodeURIComponent(auctionId)}/bids`, { query: { cursor: params.cursor, limit: params.limit ?? 20 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }

  /** The caller's OWN bids across ALL auctions (keyset), each with its EMD hold + winning flag. */
  async myBids(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<MyBid>> {
    const r = await this.http.request<MyBid[]>('GET', 'auctions/my-bids', { query: { cursor: params.cursor, limit: params.limit ?? 20 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }

  // --- watch / follow (P1-7): any authed member may watch an auction in their tenant. Watching is idempotent and
  // owner-scoped server-side; watchers are notified when the auction closes (via the notification spine). ---
  /** Start watching an auction (idempotent). Returns the current watch state. */
  async watch(auctionId: string): Promise<{ ok: boolean; auctionId: string; watching: boolean }> {
    return (await this.http.request<{ ok: boolean; auctionId: string; watching: boolean }>('POST', `auctions/${encodeURIComponent(auctionId)}/watch`, { body: {} })).data;
  }
  /** Stop watching an auction (idempotent). */
  async unwatch(auctionId: string): Promise<{ ok: boolean; auctionId: string; watching: boolean }> {
    return (await this.http.request<{ ok: boolean; auctionId: string; watching: boolean }>('DELETE', `auctions/${encodeURIComponent(auctionId)}/watch`, {})).data;
  }
  /** Whether the caller is currently watching this auction (O(1)) — drives a watch-toggle's state. */
  async isWatching(auctionId: string, signal?: AbortSignal): Promise<boolean> {
    return (await this.http.request<{ auctionId: string; watching: boolean }>('GET', `auctions/${encodeURIComponent(auctionId)}/watch`, { signal })).data.watching;
  }
  /** The caller's watched auctions (with live status/ends_at), keyset-paginated. */
  async watching(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<WatchedAuction>> {
    const r = await this.http.request<WatchedAuction[]>('GET', 'auctions/watching', { query: { cursor: params.cursor, limit: params.limit ?? 20 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
}
