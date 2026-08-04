// @krishalaya/sdk-js · reviews resource (module 5). A review is bound to a COMPLETED order; the target
// (seller↔buyer) is resolved SERVER-SIDE from verified-purchase eligibility — the client never supplies a
// target id (anti-IDOR). Create carries an Idempotency-Key (Law 3) so a double-tap can't post twice. Summary +
// the PUBLIC reviews list read only published reviews and carry NO buyer PII. Gated server-side by the `reviews` flag.
import { HttpClient } from '../http';
import { ReviewSummary, PublicReview, ReviewItem, Page } from '../types';

export class ReviewsResource {
  constructor(private readonly http: HttpClient) {}

  /** Post a review for a completed order. `stars` 1–5; optional sub-ratings/body/tags. */
  async create(input: { orderId: string; stars: number; subRatings?: Record<string, number>; body?: string; tags?: string[] }, idempotencyKey: string): Promise<{ id: string }> {
    return (await this.http.request<{ id: string }>('POST', 'reviews', { idempotencyKey, body: input })).data;
  }

  /** Aggregate rating for a target. Pass a seller's user id (`targetUserId`) for the common reputation case, or an
   *  explicit `targetType`+`targetId`. Public (anonymous) — only published reviews are counted. */
  async summary(query: { targetUserId?: string; targetType?: 'seller' | 'buyer'; targetId?: string }, signal?: AbortSignal): Promise<ReviewSummary> {
    const targetType = query.targetType ?? 'seller';
    const targetId = query.targetId ?? query.targetUserId;
    // API returns { count, avgStars, histogram }; normalize to the stable ReviewSummary shape.
    const r = await this.http.request<{ count: number; avgStars: number }>('GET', 'reviews/summary', { query: { targetType, targetId }, anonymous: true, signal });
    return { averageStars: Number(r.data?.avgStars ?? 0), count: Number(r.data?.count ?? 0) };
  }

  /** PUBLIC individual reviews for a target (anonymous storefront). PII-free (no reviewer id); published-only;
   *  keyset paginated. Pass a seller's user id via `targetUserId`, or an explicit `targetType`+`targetId`. */
  async publicReviews(query: { targetUserId?: string; targetType?: 'seller' | 'buyer'; targetId?: string; cursor?: string; limit?: number }, signal?: AbortSignal): Promise<Page<PublicReview>> {
    const targetType = query.targetType ?? 'seller';
    const targetId = query.targetId ?? query.targetUserId;
    const r = await this.http.request<PublicReview[]>('GET', 'reviews/public', { query: { targetType, targetId, cursor: query.cursor, limit: query.limit }, anonymous: true, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }

  /** Authenticated list of reviews ABOUT the caller (box=target, the reviewed party) or BY the caller (box=mine).
   *  Returns the full review (incl. reviewer id) — used by a seller to manage/respond to their own reviews. */
  async list(query: { box?: 'target' | 'mine'; targetType?: 'seller' | 'buyer'; targetId?: string; cursor?: string; limit?: number }, signal?: AbortSignal): Promise<Page<ReviewItem>> {
    const r = await this.http.request<ReviewItem[]>('GET', 'reviews', { query, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }

  /** The reviewed party (e.g. a seller) posts ONE public response to a review. Author-gated server-side. */
  async respond(reviewId: string, response: string): Promise<ReviewItem> {
    return (await this.http.request<ReviewItem>('POST', `reviews/${encodeURIComponent(reviewId)}/respond`, { body: { response } })).data;
  }
}
