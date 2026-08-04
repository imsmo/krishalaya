// apps/mobile/src/features/labour/worker-reviews.ts · PURE filter/aggregation logic for the worker "My Reviews"
// screen (screen 40). No React / no SDK I/O (SDK types are `import type` → erased) → unit-tested. The star
// DISTRIBUTION is computed from the reviews actually loaded (the summary endpoint gives only avg + total count, no
// per-star split — §13); the bars therefore reflect the shown page, never a fabricated lifetime breakdown.
import type { PublicReview } from '@krishalaya/sdk-js';

export type ReviewFilter = 'all' | 'five' | 'month';
export const REVIEW_FILTERS: readonly ReviewFilter[] = ['all', 'five', 'month'];

export interface StarRow { star: number; count: number }
/** Count of each star (5→1) across the loaded reviews. Always returns 5 rows (0-filled). Pure. */
export function starDistribution(reviews: readonly PublicReview[]): StarRow[] {
  const counts = [0, 0, 0, 0, 0]; // index 0 = 1★ … 4 = 5★
  for (const r of reviews ?? []) { const s = Math.round(r.stars); if (s >= 1 && s <= 5) counts[s - 1] += 1; }
  return [5, 4, 3, 2, 1].map((star) => ({ star, count: counts[star - 1] }));
}

/** Bar width percent for a star row relative to the busiest row (0–100). Pure. */
export function barPct(count: number, rows: readonly StarRow[]): number {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return max > 0 ? Math.round((count * 100) / max) : 0;
}

/** Apply a filter to the loaded reviews: all, 5-star only, or this calendar month (by createdAt). Pure. */
export function filterReviews(reviews: readonly PublicReview[], filter: ReviewFilter, nowMs: number = Date.now()): PublicReview[] {
  if (filter === 'five') return (reviews ?? []).filter((r) => Math.round(r.stars) === 5);
  if (filter === 'month') {
    const ym = new Date(nowMs).toISOString().slice(0, 7);
    return (reviews ?? []).filter((r) => (r.createdAt ?? '').slice(0, 7) === ym);
  }
  return [...(reviews ?? [])];
}

/** A ★-string for a whole-star rating (rounded), e.g. 4 → "★★★★☆". Pure. */
export function starString(stars: number): string {
  const n = Math.max(0, Math.min(5, Math.round(stars)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}
