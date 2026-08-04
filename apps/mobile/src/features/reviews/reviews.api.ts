// apps/mobile/src/features/reviews/reviews.api.ts · data layer for post-order reviews (P-07). A review is bound to
// a COMPLETED order; the target (who is being reviewed) is resolved SERVER-SIDE from verified-purchase eligibility
// — the client never supplies a target id (anti-IDOR, guide §4). Submit is idempotent (Law 3). Reads degrade.
import type { ReviewSummary } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { newId } from '../../core/util/ids';

/** Submit a review for a completed order. `stars` 1–5. Idempotent; throws on a real error (e.g. not eligible). */
export function submitReview(input: { orderId: string; stars: number; body?: string; tags?: string[] }): Promise<{ id: string }> {
  return apiClient().reviews.create(input, newId());
}

/** Aggregate rating for a seller (read-only; degrades to a zero summary on failure). */
export async function reviewSummary(targetUserId: string): Promise<ReviewSummary> {
  try { return await apiClient().reviews.summary({ targetUserId }); }
  catch { return { averageStars: 0, count: 0 }; }
}

/** Aggregate rating for a BUYER (the seller sees this on the order-decision screen). Public/anonymous summary,
 * keyed by the buyer's user id (resolved server-side from the order); degrades to a zero summary on failure. */
export async function buyerReviewSummary(buyerUserId: string): Promise<ReviewSummary> {
  try { return await apiClient().reviews.summary({ targetType: 'buyer', targetId: buyerUserId }); }
  catch { return { averageStars: 0, count: 0 }; }
}
