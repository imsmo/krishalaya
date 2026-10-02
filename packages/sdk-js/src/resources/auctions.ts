// @krishalaya/sdk-js · auctions resource (module 3). Browse/detail are public-within-tenant; the bid stream needs
// auction.bid or auction.read and is MASKED (B1…Bn) server-side. Placing a bid holds an EMD (earnest-money deposit) on the
// bidder's WALLET — entirely SERVER-SIDE (the client never moves money, Law 11). create + placeBid + approve carry an
// Idempotency-Key (Law 3). Money is bigint minor-unit strings (Law 2). Gated server-side by the `auctions` flag.
//
// PC-56 TENANT-11a: every price is PER UNIT of the listing's unit (F-12) — the lot is copied from the listing by the server;
// approve takes an Idempotency-Key (and, from staff, the seller's recorded consent); cancel takes a REASON (sent to every
// bidder) — while awaiting approval it is the seller's decline; pause-entry / resume-entry stop or admit NEW bidders. The
// list takes a grouped tab (`group`) and returns per-tab `counts` + `total`. Nothing was removed: `approve(id)` and
// `cancel(id)` keep their names; their new arguments are the ones the API now requires.
import { HttpClient } from '../http';
import {
  Auction, AuctionConsent, AuctionDetail, AuctionGroup, AuctionPage, BidHistoryItem, BidStreamPage, PlaceBidResult, MyBid, WatchedAuction, Page,
} from '../types';

export interface CreateAuctionInput {
  listingId: string; kind?: 'english_open' | 'sealed';
  /** Per unit of the listing's unit. */
  startPriceMinor: string; reservePriceMinor?: string; minIncrementMinor?: string;
  /** Per lot. */
  emdMinor?: string; emdPctBps?: number; startsAt: string; endsAt: string;
  autoExtendSecs?: number; extendTriggerSecs?: number; minBidders?: number; requiresSellerApproval?: boolean;
  /** The seller-decision window, 1–72 h (default 24). */
  decisionWindowHours?: number;
  /** The auction desk scheduling FOR a seller (auction.schedule_on_behalf) — the seller's recorded consent is required. */
  sellerUserId?: string; consent?: AuctionConsent;
}
export interface CreateAuctionResult { auctionId: string; auctionNo: string | null; listingId: string; status: string; quantity: string; unitCode: string; startsAt: string; endsAt: string }
export interface ApproveAuctionResult { auctionId: string; status: string; orderId: string; orderValueMinor: string; emdAppliedMinor: string; balanceDueMinor: string; balanceDueAt: string }

export class AuctionsResource {
  constructor(private readonly http: HttpClient) {}

  /** Browse auctions — by one `status`, or by the console's grouped tab (`group`). µs keyset; `counts` per tab. */
  async list(params: { status?: string; group?: AuctionGroup; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<AuctionPage> {
    const r = await this.http.request<Auction[]>('GET', 'auctions', { query: { status: params.status, group: params.group, cursor: params.cursor, limit: params.limit ?? 20 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null, total: (r.meta?.total as number | null | undefined) ?? null,
      counts: (r.meta?.counts as AuctionPage['counts'] | undefined) ?? null };
  }
  async get(id: string, signal?: AbortSignal): Promise<AuctionDetail> {
    return (await this.http.request<AuctionDetail>('GET', `auctions/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Create an auction on a listing the caller owns — or, for the desk, on a seller's listing with their consent. Idempotent. */
  async create(input: CreateAuctionInput, idempotencyKey: string): Promise<CreateAuctionResult> {
    return (await this.http.request<CreateAuctionResult>('POST', 'auctions', { idempotencyKey, body: input })).data;
  }
  /** Edit a SCHEDULED auction's terms (reserve / increment / window). */
  async update(id: string, input: { reservePriceMinor?: string | null; minIncrementMinor?: string; startsAt?: string; endsAt?: string }): Promise<Auction> {
    return (await this.http.request<Auction>('PATCH', `auctions/${encodeURIComponent(id)}`, { body: input })).data;
  }
  /** W139 "Approve — create order". Idempotent on the key (double-click safe). Staff pass the seller's consent. */
  approve(id: string, idempotencyKey: string, consent?: AuctionConsent): Promise<ApproveAuctionResult> {
    return this.http.request<ApproveAuctionResult>('POST', `auctions/${encodeURIComponent(id)}/approve`, { idempotencyKey, body: consent ? { consent } : {} }).then((r) => r.data);
  }
  /** Cancel (scheduled / live — tenant_admin for a live one) or the seller's DECLINE (awaiting approval). Reason required. */
  cancel(id: string, reason: string, consent?: AuctionConsent): Promise<{ auctionId: string; status: string; notified: number }> {
    return this.http.request<{ auctionId: string; status: string; notified: number }>('POST', `auctions/${encodeURIComponent(id)}/cancel`, { body: consent ? { reason, consent } : { reason } }).then((r) => r.data);
  }
  /** Stop NEW bidders entering a live auction (existing bidders continue). tenant_admin, reason. */
  pauseEntry(id: string, reason: string): Promise<{ auctionId: string; entryPaused: boolean }> {
    return this.http.request<{ auctionId: string; entryPaused: boolean }>('POST', `auctions/${encodeURIComponent(id)}/pause-entry`, { body: { reason } }).then((r) => r.data);
  }
  resumeEntry(id: string, reason: string): Promise<{ auctionId: string; entryPaused: boolean }> {
    return this.http.request<{ auctionId: string; entryPaused: boolean }>('POST', `auctions/${encodeURIComponent(id)}/resume-entry`, { body: { reason } }).then((r) => r.data);
  }

  /** Place a bid (PER UNIT, minor units). Holds the EMD server-side. Idempotent. */
  async placeBid(auctionId: string, amountMinor: string, idempotencyKey: string): Promise<PlaceBidResult> {
    return (await this.http.request<PlaceBidResult>('POST', `auctions/${encodeURIComponent(auctionId)}/bids`, { idempotencyKey, body: { amountMinor } })).data;
  }
  /** The masked bid stream (newest-first, µs keyset). Sealed auctions mask others' amounts until close (server-side). */
  async listBids(auctionId: string, params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<BidStreamPage> {
    const r = await this.http.request<BidHistoryItem[]>('GET', `auctions/${encodeURIComponent(auctionId)}/bids`, { query: { cursor: params.cursor, limit: params.limit ?? 20 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null, bidders: (r.meta?.bidders as number | undefined) ?? null,
      sealedHidden: (r.meta?.sealedHidden as boolean | undefined) ?? null, identitiesRevealed: (r.meta?.identitiesRevealed as boolean | undefined) ?? null };
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
