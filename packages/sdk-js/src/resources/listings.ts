// @krishalaya/sdk-js · listings resource (the marketplace browse surface, GET /v1/listings).
import { HttpClient } from '../http';
import { ListingCard, ListingQuery, BoostTier, BoostWalletPayResult, ListingAnalytics, ListingInquiry, ListingTrustDocument, SellerPublicProfile, GalleryItem, Page, ConsoleListingRow, ConsoleCounts, QcQueuePayload, QcReviewPayload, PriceHistoryEntry, FairPriceGuide } from '../types';

export class ListingsResource {
  constructor(private readonly http: HttpClient) {}

  /** Browse/search published listings (keyset cursor). Anonymous (public catalogue). */
  async browse(query: ListingQuery = {}, signal?: AbortSignal): Promise<Page<ListingCard>> {
    const r = await this.http.request<ListingCard[]>('GET', 'listings', {
      anonymous: true, signal,
      query: { q: query.q, categoryId: query.categoryId, regionId: query.regionId, saleType: query.saleType,
        organic: query.organic, priceMinMinor: query.priceMinMinor, priceMaxMinor: query.priceMaxMinor,
        sort: query.sort, cursor: query.cursor, limit: query.limit },
    });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null, total: (r.meta?.total as number | null) ?? null };
  }
  /** A single published listing by id (public/visibility-gated). */
  async get(id: string, signal?: AbortSignal): Promise<ListingCard> {
    return (await this.http.request<ListingCard>('GET', `listings/${encodeURIComponent(id)}`, { anonymous: true, signal })).data;
  }

  /** Signed photo gallery for a public listing (short-lived presigned urls; clean assets only). Public. */
  async media(id: string, signal?: AbortSignal): Promise<GalleryItem[]> {
    return (await this.http.request<GalleryItem[]>('GET', `listings/${encodeURIComponent(id)}/media`, { anonymous: true, signal })).data;
  }

  /** Public seller storefront profile (safe fields + rating + active-listing count; no PII). Public. */
  async sellerPublic(sellerId: string, signal?: AbortSignal): Promise<SellerPublicProfile> {
    return (await this.http.request<SellerPublicProfile>('GET', `sellers/${encodeURIComponent(sellerId)}/public`, { anonymous: true, signal })).data;
  }

  /** A single listing the AUTHENTICATED caller owns (same path, but authenticated → owner can see drafts). */
  async getOwn(id: string, signal?: AbortSignal): Promise<ListingCard> {
    return (await this.http.request<ListingCard>('GET', `listings/${encodeURIComponent(id)}`, { signal })).data;
  }

  /** Create a listing (draft). `mediaIds` are confirmed uploads (core/media). Idempotency-keyed (Law 3). */
  async create(dto: CreateListingInput, idempotencyKey: string): Promise<{ id: string }> {
    return (await this.http.request<{ id: string }>('POST', 'listings', { idempotencyKey, body: dto })).data;
  }

  /** Publish a draft listing (owner-only, server-enforced). */
  async publish(id: string): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('POST', `listings/${encodeURIComponent(id)}/publish`)).data;
  }

  /** Change price with optimistic concurrency (expectedVersion). Money is a bigint minor-unit string (Law 2). */
  async changePrice(id: string, priceMinor: string, expectedVersion: number): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('PATCH', `listings/${encodeURIComponent(id)}/price`, { body: { priceMinor, expectedVersion } })).data;
  }

  /** Repost an expired/sold-out listing back to 'published' for a fresh window (keeps photos/details). Optional
   *  new price (bigint minor string — Law 2) + durationDays (server defaults to 7). Owner-only (server-enforced). */
  async repost(id: string, opts: { newPriceMinor?: string; durationDays?: number } = {}): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('POST', `listings/${encodeURIComponent(id)}/repost`, { body: opts })).data;
  }

  /** AUTHED gallery read — same route as media(), but with the bearer token so an owner or moderator sees
   *  their own/reviewable clean photos regardless of listing status (the QC review's photo panel). */
  async mediaOwn(id: string, signal?: AbortSignal): Promise<GalleryItem[]> {
    return (await this.http.request<GalleryItem[]>('GET', `listings/${encodeURIComponent(id)}/media`, { signal })).data;
  }

  // ---- PC-56 TENANT-2a · staff console + QC (W123/W126/W127). Console reads need `listing.view_any`;
  // QC reads/decisions need `listing.approve` — the server enforces both, these are just the typed doors.

  /** W123 — every seller's listings, one status tab at a time (closed vocabulary), keyset cursor. */
  async consoleList(query: { status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: ConsoleListingRow[]; nextCursor: string | null }> {
    return (await this.http.request<{ items: ConsoleListingRow[]; nextCursor: string | null }>('GET', 'listings/console/list', { signal, query })).data;
  }

  /** W123's tabs — a count for every status in the machine, zero included. */
  async consoleCounts(signal?: AbortSignal): Promise<ConsoleCounts> {
    return (await this.http.request<ConsoleCounts>('GET', 'listings/console/counts', { signal })).data;
  }

  /** W126 — the QC queue (oldest first), its measured KPIs and the closed rejection vocabulary. */
  async qcQueue(signal?: AbortSignal): Promise<QcQueuePayload> {
    return (await this.http.request<QcQueuePayload>('GET', 'listings/qc/queue', { signal })).data;
  }

  /** W127 — one submission with the honest review facts (seller record, peer price band, self-review flag). */
  async qcReview(id: string, signal?: AbortSignal): Promise<QcReviewPayload> {
    return (await this.http.request<QcReviewPayload>('GET', `listings/qc/review/${encodeURIComponent(id)}`, { signal })).data;
  }

  /** Send a draft to QC — starts the waiting clock. Owner (or moderator). */
  async submitForQc(id: string): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('POST', `listings/${encodeURIComponent(id)}/submit-qc`)).data;
  }

  /** Approve — publishes immediately. Reviewer ≠ seller/creator is the server's law. */
  async qcApprove(id: string): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('POST', `listings/${encodeURIComponent(id)}/qc/approve`)).data;
  }

  /** Reject with a teaching reason from the closed vocabulary. */
  async qcReject(id: string, reasonCode: string): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('POST', `listings/${encodeURIComponent(id)}/qc/reject`, { body: { reasonCode } })).data;
  }

  /** Pause the seller's own published listing (their hand, not the platform's `held`). */
  async pause(id: string): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('POST', `listings/${encodeURIComponent(id)}/pause`)).data;
  }

  /** The paid-boost tier catalogue (id + name + server price/days). Show real prices; submit a real tier id. */
  async boostTiers(signal?: AbortSignal): Promise<BoostTier[]> {
    return (await this.http.request<BoostTier[]>('GET', 'listings/boost-tiers', { signal })).data;
  }

  /** Start a paid visibility boost. `paymentTxnId` proves the wallet already captured payment (Law 2). */
  async startBoost(id: string, dto: { boostTierId: string; priceMinor: string; currencyCode?: string; days: number; paymentTxnId: string }, idempotencyKey: string): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('POST', `listings/${encodeURIComponent(id)}/boosts`, { idempotencyKey, body: dto })).data;
  }

  /** Pay for a boost straight from the wallet: send only the tier id, the server resolves the price +
   *  debits the wallet (fails closed on insufficient balance). Idempotency-keyed (Law 3). */
  async payBoostFromWallet(id: string, boostTierId: string, idempotencyKey: string, currencyCode?: string): Promise<BoostWalletPayResult> {
    return (await this.http.request<BoostWalletPayResult>('POST', `listings/${encodeURIComponent(id)}/boosts/pay-from-wallet`, { idempotencyKey, body: { boostTierId, currencyCode } })).data;
  }

  /** Seller engagement analytics for the caller's OWN listing (offers / price changes / boosts / views). 404 if not owner. */
  async analytics(id: string, signal?: AbortSignal): Promise<ListingAnalytics> {
    return (await this.http.request<ListingAnalytics>('GET', `listings/${encodeURIComponent(id)}/analytics`, { signal })).data;
  }

  /** Record ONE per-impression view (P1-15). FIRE-AND-FORGET: emits onto the event pipeline (counted off-band by
   *  the stream-processor → listing_view_counts), so there is no hot-path cost. Best-effort telemetry: resolves to
   *  { ok } when the `listing_views` flag is on, 404 when it's off; a dropped impression is acceptable. */
  async recordView(id: string): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('POST', `listings/${encodeURIComponent(id)}/view`)).data;
  }

  /** Push an active listing's expiry out by `days` WITHOUT resetting stats/views (screen 112's EXTEND cta;
   *  KV-BL-031). Owner-only (server-enforced). Idempotency-keyed (Law 3) — a retried tap returns the same result. */
  async extend(id: string, days: number, idempotencyKey: string): Promise<{ id: string; expiresAt: string | null }> {
    return (await this.http.request<{ id: string; expiresAt: string | null }>('POST', `listings/${encodeURIComponent(id)}/extend`, { idempotencyKey, body: { days } })).data;
  }

  /** Archive (remove) the caller's OWN listing — terminal, no transition back out (screen 112 Remove cta;
   *  KV-MF-08). Owner-only (server-enforced). Idempotency-keyed (Law 3) — a retried tap returns the same result. */
  /** TENANT-2b: `reason` is MANDATORY when a staff hand archives a member's listing (the server enforces the
   *  actor≠seller rule and the seller is notified with it); optional for a seller removing their own. */
  async archive(id: string, idempotencyKey: string, reason?: string): Promise<{ id: string; status: string }> {
    return (await this.http.request<{ id: string; status: string }>('POST', `listings/${encodeURIComponent(id)}/archive`, { idempotencyKey, body: reason ? { reason } : {} })).data;
  }

  // ---- PC-56 TENANT-2b · W124/W125 ----

  /** The price trail (owner-or-moderator; 404 to anyone else). Newest first. */
  async priceHistory(id: string, signal?: AbortSignal): Promise<PriceHistoryEntry[]> {
    return (await this.http.request<PriceHistoryEntry[]>('GET', `listings/${encodeURIComponent(id)}/price-history`, { signal })).data;
  }

  /** rejected → draft (one-tap fix-and-relist) or pending_approval → draft (withdraw from the queue). */
  async redraft(id: string): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('POST', `listings/${encodeURIComponent(id)}/redraft`)).data;
  }

  /** W125's fair-price guide: the peer band (same read QC trusts) resolved from a pincode. Null band = no
   *  comparable published listings or unmappable pincode — the caller says which, never invents a range. */
  async fairPrice(productId: string, pincode: string, signal?: AbortSignal): Promise<FairPriceGuide> {
    return (await this.http.request<FairPriceGuide>('GET', 'listings/fair-price', { signal, query: { productId, pincode } })).data;
  }

  /** Staff listing on a MEMBER's behalf — consent-gated server-side (purpose on_behalf_listing); needs
   *  listing.moderate. The staff identity is recorded, so QC's no-self-review sees it. */
  async createOnBehalf(dto: CreateListingInput & { sellerUserId: string }, idempotencyKey: string): Promise<{ id: string }> {
    return (await this.http.request<{ id: string }>('POST', 'listings/on-behalf', { idempotencyKey, body: dto })).data;
  }

  /** Paginated buyer inquiries into the caller's OWN listing (owner-only, 404 else; keyset cursor). */
  async inquiries(id: string, params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<ListingInquiry>> {
    const r = await this.http.request<ListingInquiry[]>('GET', `listings/${encodeURIComponent(id)}/inquiries`, { query: { cursor: params.cursor, limit: params.limit ?? 20 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }

  /** Link an already-uploaded, clean media asset (kind='document') to a listing as a trust document (lab report /
   *  certification / other). verifiedAt stays null until an ops verification flow (out of scope) sets it. */
  async attachTrustDocument(id: string, dto: { mediaAssetId: string; docType: 'lab_report' | 'certification' | 'other' }): Promise<ListingTrustDocument> {
    return (await this.http.request<ListingTrustDocument>('POST', `listings/${encodeURIComponent(id)}/trust-documents`, { body: dto })).data;
  }

  /** Attach ONE more already-uploaded, clean IMAGE to the caller's OWN, already-created listing (screen 112
   *  "Listing health → Add more photos" cta; KV-MF-14). Owner-only (server-enforced). Returns the listing's
   *  live photo count (whether this call just added the photo or it was already attached — idempotent). */
  async addPhoto(id: string, mediaAssetId: string): Promise<{ photoCount: number }> {
    return (await this.http.request<{ photoCount: number }>('POST', `listings/${encodeURIComponent(id)}/photos`, { body: { mediaAssetId } })).data;
  }
}

/** Create-listing payload (mirrors the API zod .strict() CreateListingSchema). Money is a string of minor units. */
export interface CreateListingInput {
  productId: string; categoryId: string; title: string; description?: string;
  quantityTotal: number; minOrderQty?: number; unitCode: string;
  priceMinor: string; currencyCode?: string;
  saleType?: 'direct' | 'auction' | 'both' | 'preorder' | 'service' | 'group_lot';
  organicClaim?: 'none' | 'natural' | 'certified';
  pincode?: string; regionId?: string; visibility?: 'tenant' | 'cross_tenant' | 'public';
  mediaIds?: string[];
  harvestDate?: string;   // TENANT-2b: YYYY-MM-DD — 0005's column, first carried
}
