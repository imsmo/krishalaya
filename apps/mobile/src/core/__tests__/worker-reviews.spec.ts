// Unit tests for the PURE worker-reviews logic (screen 40).
import { starDistribution, barPct, filterReviews, starString, type ReviewFilter } from '../../features/labour/worker-reviews';
import type { PublicReview } from '@krishalaya/sdk-js';

const r = (stars: number, createdAt: string): PublicReview => ({
  id: `${stars}-${createdAt}`, stars, subRatings: {}, body: null, tags: [], isVerifiedPurchase: true,
  sellerResponse: null, sellerRespondedAt: null, helpfulCount: 0, createdAt,
});
const now = Date.parse('2026-08-15T00:00:00Z');
const R = [r(5, '2026-08-13T00:00:00Z'), r(5, '2026-08-08T00:00:00Z'), r(4, '2026-07-28T00:00:00Z'), r(5, '2026-08-02T00:00:00Z')];

describe('worker reviews (screen 40)', () => {
  it('starDistribution counts per star, 5 rows 5→1', () => {
    const d = starDistribution(R);
    expect(d.map((x) => x.star)).toEqual([5, 4, 3, 2, 1]);
    expect(d.find((x) => x.star === 5)!.count).toBe(3);
    expect(d.find((x) => x.star === 4)!.count).toBe(1);
    expect(d.find((x) => x.star === 1)!.count).toBe(0);
  });
  it('barPct relative to busiest row', () => {
    const d = starDistribution(R);
    expect(barPct(3, d)).toBe(100); // 5★ is busiest (3)
    expect(barPct(0, d)).toBe(0);
    expect(barPct(0, starDistribution([]))).toBe(0); // no divide-by-zero
  });
  it('filterReviews: all / five / month', () => {
    expect(filterReviews(R, 'all', now).length).toBe(4);
    expect(filterReviews(R, 'five', now).length).toBe(3);
    expect(filterReviews(R, 'month', now).map((x) => x.stars)).toEqual([5, 5, 5]); // Aug only (drops Jul 28)
  });
  it('starString renders filled/empty stars', () => {
    expect(starString(5)).toBe('★★★★★');
    expect(starString(4)).toBe('★★★★☆');
    expect(starString(4.6)).toBe('★★★★★'); // rounds
    expect(starString(0)).toBe('☆☆☆☆☆');
  });
});
