// apps/web-storefront/src/features/reviews/display.ts · PURE review-display helpers (no React/IO) → unit-tested.
// The reviews themselves come from the API's PII-free public endpoint (payments-free); these helpers only shape
// what the presentational list renders. No fabrication.
import type { PublicReview } from '@krishalaya/sdk-js';

/** A 5-glyph star string for a rating (clamped to 0–5, rounded). e.g. 4 → "★★★★☆". */
export function starGlyphs(stars: number): string {
  const n = Math.max(0, Math.min(5, Math.round(Number.isFinite(stars) ? stars : 0)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

/** True when a review has any displayable content beyond the bare star rating (body or a seller response). */
export function hasReviewContent(r: Pick<PublicReview, 'body' | 'sellerResponse'>): boolean {
  return !!(r.body && r.body.trim()) || !!(r.sellerResponse && r.sellerResponse.trim());
}
