// apps/web-tenant/src/features/reviews/respond.ts · PURE validation for a seller's review response (no React/IO)
// → unit-tested. Mirrors the API DTO (1–4000 chars after trim) so an obviously-bad response never round-trips.
export type ResponseValidation = { ok: true; value: string } | { ok: false; error: 'empty' | 'too_long' };

export function validateReviewResponse(raw: string | null | undefined): ResponseValidation {
  const text = (typeof raw === 'string' ? raw : '').trim();
  if (text.length === 0) return { ok: false, error: 'empty' };
  if (text.length > 4000) return { ok: false, error: 'too_long' };
  return { ok: true, value: text };
}

// PC-56 STORE-5a · D2 (founder Q8) — the ORGANISATION replies to and FLAGS its buyers' reviews; it never hides or removes them. The flag's
// failures by name (`?error=`): the API's REVIEW_FLAG_FORBIDDEN (no `review.flag`), an illegal move (already with the platform desk, removed),
// anything else. The reply is served as the organisation's (`respondedBy: 'organisation'`) — this console never prints who typed it.
export type FlagErrorKey = 'review_flag_forbidden' | 'review_flag_illegal' | 'review_flag';
export function flagErrorKey(code: string | null | undefined, status: number | null | undefined): FlagErrorKey {
  if (code === 'REVIEW_FLAG_FORBIDDEN' || status === 403) return 'review_flag_forbidden';
  if (code === 'REVIEW_ILLEGAL_TRANSITION' || code === 'REVIEW_REMOVED' || status === 409) return 'review_flag_illegal';
  return 'review_flag';
}
/** Only a review that is live can be flagged (a flagged one is already with the platform desk). */
export function canFlagReview(status: string | null | undefined): boolean { return status === 'published'; }
