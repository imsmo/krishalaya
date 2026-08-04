// Unit tests for the PURE saved-listings logic (screen 126). No React/native deps.
import { priceDropMinor, droppedCount, filterSaved, SAVED_ALL, SAVED_DROPPED } from '../../features/buyer/saved-listings';
import type { ListingCard } from '@krishalaya/sdk-js';

const card = (id: string, priceMinor: string): ListingCard => ({
  id, title: id, priceMinor, currencyCode: 'INR', unitCode: 'qtl', quantityAvailable: 1,
  organicClaim: false, saleType: 'fixed', regionId: null, sellerUserId: 's1', boosted: false,
});

describe('saved-listings (screen 126)', () => {
  it('priceDropMinor = saved − current when cheaper, else null', () => {
    expect(priceDropMinor('292000', '288000')).toBe('4000'); // ₹40 drop
    expect(priceDropMinor('288000', '288000')).toBeNull();   // unchanged
    expect(priceDropMinor('288000', '300000')).toBeNull();   // dearer
    expect(priceDropMinor('bad', '288000')).toBeNull();
  });
  it('droppedCount tallies only listings with a real drop', () => {
    const items = [card('a', '1'), card('b', '1'), card('c', '1')];
    expect(droppedCount(items, { a: '4000', b: null, c: '6000' })).toBe(2);
    expect(droppedCount(items, {})).toBe(0);
  });
  it('filterSaved: all → everything; dropped → only drops', () => {
    const items = [card('a', '1'), card('b', '1')];
    const drops = { a: '4000', b: null };
    expect(filterSaved(items, SAVED_ALL, drops)).toHaveLength(2);
    expect(filterSaved(items, SAVED_DROPPED, drops).map((i) => i.id)).toEqual(['a']);
  });
});
