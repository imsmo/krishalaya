// Unit tests for the PURE boost helpers (screen 114): tier-kind mapping, price sort, recommended pick.
import { tierKind, sortByPrice, pickRecommendedTier } from '../../features/listings/boost';
import type { BoostTier } from '@krishalaya/sdk-js';

const t = (id: string, code: string, priceMinor: string, days: number): BoostTier => ({ id, code, name: id, priceMinor, days });

describe('tierKind', () => {
  it('maps known codes to a kind (case/format tolerant)', () => {
    expect(tierKind('LOCAL')).toBe('local');
    expect(tierKind('boost_local_3d')).toBe('local');
    expect(tierKind('regional')).toBe('regional');
    expect(tierKind('region-100km')).toBe('regional');
    expect(tierKind('statewide')).toBe('statewide');
    expect(tierKind('national_multi')).toBe('statewide');
  });
  it('degrades unknown/empty codes to generic (never guesses a radius)', () => {
    expect(tierKind('premium_xyz')).toBe('generic');
    expect(tierKind('')).toBe('generic');
    expect(tierKind(null)).toBe('generic');
    expect(tierKind(undefined)).toBe('generic');
  });
});

describe('sortByPrice', () => {
  it('orders cheapest→dearest by bigint minor (no float), without mutating input', () => {
    const tiers = [t('c', 'statewide', '39900', 14), t('a', 'local', '4900', 3), t('b', 'regional', '14900', 7)];
    const out = sortByPrice(tiers);
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(tiers[0].id).toBe('c'); // original untouched
  });
  it('treats an unparseable price as 0 rather than throwing', () => {
    const out = sortByPrice([t('x', 'k', 'NaN', 1), t('y', 'k', '100', 1)]);
    expect(out[0].id).toBe('x');
  });
});

describe('pickRecommendedTier', () => {
  it('selects the middle tier by price (the design highlights Regional)', () => {
    const tiers = [t('local', 'local', '4900', 3), t('regional', 'regional', '14900', 7), t('statewide', 'statewide', '39900', 14)];
    expect(pickRecommendedTier(tiers)?.id).toBe('regional');
  });
  it('returns null for an empty catalogue', () => {
    expect(pickRecommendedTier([])).toBeNull();
  });
  it('handles a single tier', () => {
    expect(pickRecommendedTier([t('only', 'local', '4900', 3)])?.id).toBe('only');
  });
});
