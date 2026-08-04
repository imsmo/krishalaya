// apps/web-storefront/src/test/auctions-bid.spec.ts · auction bid math is BigInt-only (Law 2). Pins that the high
// bid + suggested minimum are computed without float drift, and that sealed (null-amount) bids are ignored.
import type { Auction, BidHistoryItem } from '@krishalaya/sdk-js';
import { currentHighMinor, minNextBidMinor, emdRequirement } from '../features/auctions/bid';

const bid = (id: string, amountMinor: string | null): BidHistoryItem => ({ id, bidderUserId: 'u', amountMinor });
const auction = (start: string, inc: string): Pick<Auction, 'startPriceMinor' | 'minIncrementMinor'> => ({ startPriceMinor: start, minIncrementMinor: inc });

describe('currentHighMinor', () => {
  it('returns the max visible amount', () => {
    expect(currentHighMinor([bid('a', '1000'), bid('b', '2500'), bid('c', '1500')])).toBe('2500');
  });
  it('ignores sealed (null) amounts; null when none visible', () => {
    expect(currentHighMinor([bid('a', null), bid('b', null)])).toBeNull();
    expect(currentHighMinor([])).toBeNull();
  });
  it('no float drift on large values', () => {
    expect(currentHighMinor([bid('a', '90071992547409910'), bid('b', '90071992547409920')])).toBe('90071992547409920');
  });
});

describe('minNextBidMinor', () => {
  it('first bid must clear the start price', () => {
    expect(minNextBidMinor(auction('10000', '500'), [])).toBe('10000');
  });
  it('later bids must clear high + increment (BigInt add)', () => {
    expect(minNextBidMinor(auction('10000', '500'), [bid('a', '12000')])).toBe('12500');
  });
  it('handles a zero/blank increment safely', () => {
    expect(minNextBidMinor(auction('10000', ''), [bid('a', '12000')])).toBe('12000');
  });
});

describe('emdRequirement (P1-8)', () => {
  it('prefers a flat emdMinor when > 0', () => {
    expect(emdRequirement({ emdMinor: '50000', emdPctBps: 200 })).toEqual({ kind: 'flat', minor: '50000' });
  });
  it('falls back to pct when no flat amount', () => {
    expect(emdRequirement({ emdMinor: '0', emdPctBps: 500 })).toEqual({ kind: 'pct', pctBps: 500 });
  });
  it('none when neither set / bad input', () => {
    expect(emdRequirement({ emdMinor: '0', emdPctBps: null })).toEqual({ kind: 'none' });
    expect(emdRequirement({ emdMinor: 'x', emdPctBps: 0 })).toEqual({ kind: 'none' });
  });
});
