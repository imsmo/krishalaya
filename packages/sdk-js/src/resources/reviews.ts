// @krishalaya/sdk-js · reviews resource (module 5). A review is bound to a COMPLETED order; the target
// (seller↔buyer) is resolved SERVER-SIDE from verified-purchase eligibility — the client never supplies a
// target id (anti-IDOR). Create carries an Idempotency-Key (Law 3) so a double-tap can't post twice. Summary +
// the PUBLIC reviews list read only published reviews and carry NO buyer PII. Gated server-side by the `reviews` flag.
import { HttpClient } from '../http';
import { ReviewSummary, PublicReview, ReviewItem, Page, PublicReviewTarget } from '../types';

export class ReviewsResource {
  constructor(private readonly http: HttpClient) {}

  /** Post a review for a completed order. `stars` 1–5; optional sub-ratings/body/tags. */
  async create(input: { orderId: string; stars: number; subRatings?: Record<string, number>; body?: string; tags?: string[] }, idempotencyKey: string): Promise<{ id: string }> {
    return (await this.http.request<{ id: string }>('POST', 'reviews', { idempotencyKey, body: input })).data;
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
  async list(query: { box?: 'target' | 'mine'; targetType?: 'seller' | 'buyer'; targetId?: string; cursor?: string; limit?: number }, signal?: AbortSignal): Promise<Page<ReviewItem>> {
    const r = await this.http.request<ReviewItem[]>('GET', 'reviews', { query, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }

  /** The reviewed party (e.g. a seller) posts ONE public response to a review. Author-gated server-side. */
  async respond(reviewId: string, response: string): Promise<ReviewItem> {
    return (await this.http.request<ReviewItem>('POST', `reviews/${encodeURIComponent(reviewId)}/respond`, { body: { response } })).data;
  }
}
