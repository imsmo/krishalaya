// @krishalaya/sdk-js · reviews resource (module 5). A review is bound to a COMPLETED order; the target
// (seller↔buyer) is resolved SERVER-SIDE from verified-purchase eligibility — the client never supplies a
// target id (anti-IDOR). Create carries an Idempotency-Key (Law 3) so a double-tap can't post twice. Summary +
// the PUBLIC reviews list read only published reviews and carry NO buyer PII. Gated server-side by the `reviews` flag.
import { HttpClient } from '../http';
import { ReviewSummary, PublicReview, ReviewItem, Page, PublicReviewTarget, ReviewMine, ReviewEligibility, ReviewPreview, ReviewInput, LookupValue } from '../types';

export class ReviewsResource {
  constructor(private readonly http: HttpClient) {}

  /** Post a review for a completed order. `stars` 1–5; optional sub-ratings/body/tags. */
  async create(input: ReviewInput, idempotencyKey: string): Promise<{ id: string }> {
    return (await this.http.request<{ id: string }>('POST', 'reviews', { idempotencyKey, body: input })).data;
  }

  /** PC-56 STORE-5a · B5 — W3145's confirm: the SERVER's review as it will publish (the organisation, the stars and dimension labels, "Verified
   *  buyer", the lock instant and the window's end) with the same refusals a submit gives (REVIEW_NOT_ELIGIBLE / REVIEW_DUPLICATE /
   *  REVIEW_WINDOW_CLOSED / REVIEW_DIMENSION_UNKNOWN / REVIEW_INVALID). Writes nothing. */
  async preview(input: ReviewInput, signal?: AbortSignal): Promise<ReviewPreview> {
    return (await this.http.request<ReviewPreview>('POST', 'reviews/preview', { body: input, signal })).data;
  }
  /** PC-56 STORE-5a · B5 — the caller's own review of one order (+ `editLocksAt`, `editable`); 404 when there is none. */
  async mine(query: { orderId: string }, signal?: AbortSignal): Promise<ReviewMine> {
    return (await this.http.request<ReviewMine>('GET', 'reviews/mine', { query, signal })).data;
  }
  /** PC-56 STORE-5a · B5 — may the caller review this order, until when, is the window open, did they already. */
  async eligibility(query: { orderId: string }, signal?: AbortSignal): Promise<ReviewEligibility> {
    return (await this.http.request<ReviewEligibility>('GET', 'reviews/eligibility', { query, signal })).data;
  }
  /** PC-56 STORE-5a · B5 — the sub-rating vocabulary (`review_dimension`), locale-resolved: the EXISTING public `GET lookups/values` route. */
  async dimensions(signal?: AbortSignal): Promise<LookupValue[]> {
    return (await this.http.request<LookupValue[]>('GET', 'lookups/values', { query: { type: 'review_dimension' }, anonymous: true, signal })).data;
  }
  /** PC-56 STORE-5a · B5 — the author edits their review inside the edit window (409 REVIEW_LOCKED after it); the key minted at render makes a
   *  Retry the same request. */
  async edit(reviewId: string, patch: { stars?: number; subRatings?: Record<string, number>; body?: string | null }, idempotencyKey?: string): Promise<ReviewItem> {
    return (await this.http.request<ReviewItem>('PATCH', `reviews/${encodeURIComponent(reviewId)}`, { body: patch, idempotencyKey })).data;
  }
  /** PC-56 STORE-5a · B5 (founder D2) — the organisation FLAGS a review for the platform desk (→ under moderation, out of public view until the
   *  desk decides). Needs `review.flag` (403 REVIEW_FLAG_FORBIDDEN). The organisation never hides or removes a buyer's review. */
  async flag(reviewId: string, reason?: string): Promise<ReviewItem> {
    return (await this.http.request<ReviewItem>('POST', `reviews/${encodeURIComponent(reviewId)}/moderate`, { body: reason ? { action: 'flag', reason } : { action: 'flag' } })).data;
  }

  /** PUBLIC aggregate rating — PC-56 HOTFIX-7 · B5: `{ targetType: 'organisation' }` (the organisation in context; published seller reviews).
   *  `targetUserId` / `targetType: 'seller' | 'buyer'` still COMPILE (mobile, named for the mobile wave) but the API refuses a person's uuid by
   *  name (422 REVIEW_PUBLIC_SELLER_REFUSED / REVIEW_PUBLIC_BUYER_REFUSED). Only published reviews are counted. */
  async summary(query: { targetUserId?: string; targetType?: PublicReviewTarget; targetId?: string }, signal?: AbortSignal): Promise<ReviewSummary> {
    const targetType = query.targetType ?? (query.targetUserId || query.targetId ? 'seller' : 'organisation');
    const targetId = targetType === 'organisation' ? undefined : (query.targetId ?? query.targetUserId);
    // API returns { count, avgStars, histogram }; normalize to the stable ReviewSummary shape.
    const r = await this.http.request<{ count: number; avgStars: number }>('GET', 'reviews/summary', { query: { targetType, targetId }, anonymous: true, signal });
    return { averageStars: Number(r.data?.avgStars ?? 0), count: Number(r.data?.count ?? 0) };
  }

  /** PUBLIC individual reviews (anonymous storefront) — PC-56 HOTFIX-7 · B5: `{ targetType: 'organisation' }`, every published seller review of
   *  the organisation in context; PII-free and uuid-free rows (no reviewer, order, target or review id); published-only; keyset paginated (an
   *  opaque cursor). A person's uuid (`targetUserId`, `seller`, `buyer`) compiles but is refused by the API by name (see `summary`). */
  async publicReviews(query: { targetUserId?: string; targetType?: PublicReviewTarget; targetId?: string; cursor?: string; limit?: number }, signal?: AbortSignal): Promise<Page<PublicReview>> {
    const targetType = query.targetType ?? (query.targetUserId || query.targetId ? 'seller' : 'organisation');
    const targetId = targetType === 'organisation' ? undefined : (query.targetId ?? query.targetUserId);
    const r = await this.http.request<PublicReview[]>('GET', 'reviews/public', { query: { targetType, targetId, cursor: query.cursor, limit: query.limit }, anonymous: true, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }

  /** Authenticated list of reviews ABOUT a target (box=target) or BY the caller (box=mine). PC-56 HOTFIX-7 · B5: each row is projected for the
   *  caller (the organisation's side sees the buyer; the author never sees the target's uuid; a stranger gets the public row). */
  /** PC-56 STORE-5a · D2: `box: 'organisation'` — the organisation's own reviews, for its staff (members and the desk only). */
  async list(query: { box?: 'target' | 'mine' | 'organisation'; targetType?: 'seller' | 'buyer'; targetId?: string; cursor?: string; limit?: number }, signal?: AbortSignal): Promise<Page<ReviewItem>> {
    const r = await this.http.request<ReviewItem[]>('GET', 'reviews', { query, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }

  /** The ORGANISATION posts its ONE public reply to a review of it (PC-56 STORE-5a · D2: any organisation role; served as the organisation's). */
  async respond(reviewId: string, response: string): Promise<ReviewItem> {
    return (await this.http.request<ReviewItem>('POST', `reviews/${encodeURIComponent(reviewId)}/respond`, { body: { response } })).data;
  }
}
