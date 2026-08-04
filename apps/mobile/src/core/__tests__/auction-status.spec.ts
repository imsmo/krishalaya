// Unit tests for the PURE auction logic (features/auctions/auction-status). No React/native deps (SDK/ui types are
// type-only). Money is bigint minor strings (Law 2) — current price / min-next / bid validation use BigInt.
import { auctionStatusTone, isBiddable, currentPriceMinor, minNextBidMinor, validateBidRupees, isOutbid, emdRequirement, timeLeft, bidStats, bidAmountMinor, emdHoldMinor, walletCoversHold, myBidBucket, matchesMyBidTab, myBidCounts, buildCreateAuctionDraft, auctionEndsAt, formatClock, pctAboveReserve, winningBidAmountMinor, auctionDurationParts, myHighestBidMinor, shortByMinor, recommendedBidMinor } from '../../features/auctions/auction-status';

describe('Outbid (screen 193)', () => {
  const mk = (id: string, bidderUserId: string, amountMinor: string | null): BidHistoryItem => ({ id, bidderUserId, amountMinor, createdAt: '2026-06-01T00:00:00Z' });
  it('myHighestBidMinor finds the caller’s top bid; null if none', () => {
    const bids = [mk('1', 'me', '290000'), mk('2', 'other', '295000'), mk('3', 'me', '280000')];
    expect(myHighestBidMinor(bids, 'me')).toBe('290000');
    expect(myHighestBidMinor(bids, 'nobody')).toBeNull();
  });
  it('shortByMinor = current − myBid (≥0); null if my bid unknown', () => {
    expect(shortByMinor('295000', '290000')).toBe('5000');
    expect(shortByMinor('290000', '295000')).toBe('0');
    expect(shortByMinor('295000', null)).toBeNull();
  });
  it('recommendedBidMinor = minNext + one increment; falls back without increment', () => {
    expect(recommendedBidMinor('295500', '3000')).toBe('298500');
    expect(recommendedBidMinor('295500', null)).toBe('295500');
    expect(recommendedBidMinor('295500', '0')).toBe('295500');
  });
});

describe('Auction Complete (screen 66)', () => {
  const mk = (id: string, amountMinor: string): BidHistoryItem => ({ id, bidderUserId: 'u', amountMinor, createdAt: '2026-06-01T00:00:00Z' });
  it('winningBidAmountMinor prefers winningBidId; falls back to top', () => {
    const bids = [mk('w', '305000'), mk('x', '300000')];
    expect(winningBidAmountMinor({ winningBidId: 'w', startPriceMinor: '280000' }, bids)).toBe('305000');
    expect(winningBidAmountMinor({ winningBidId: null, startPriceMinor: '280000' }, bids)).toBe('305000');
    expect(winningBidAmountMinor({ winningBidId: 'gone', startPriceMinor: '280000' }, bids)).toBe('305000');
    expect(winningBidAmountMinor({ winningBidId: null, startPriceMinor: '280000' }, [])).toBe('280000');
  });
  it('auctionDurationParts splits into days + hours', () => {
    expect(auctionDurationParts('2026-06-30T09:30:00Z', '2026-06-30T15:30:00Z')).toEqual({ days: 0, hours: 6 });
    expect(auctionDurationParts('2026-06-28T09:00:00Z', '2026-06-30T13:00:00Z')).toEqual({ days: 2, hours: 4 });
    expect(auctionDurationParts('bad', 'x')).toEqual({ days: 0, hours: 0 });
  });
});

describe('Your Auction live (screen 65)', () => {
  it('formatClock pads HH:MM:SS and clamps at 0', () => {
    expect(formatClock((2 * 3600 + 14 * 60 + 36) * 1000)).toBe('02 : 14 : 36');
    expect(formatClock(0)).toBe('00 : 00 : 00');
    expect(formatClock(-5000)).toBe('00 : 00 : 00');
    expect(formatClock(50 * 3600 * 1000)).toBe('50 : 00 : 00');
  });
  it('pctAboveReserve rounds the whole-percent vs reserve; null when no reserve', () => {
    expect(pctAboveReserve('305000', '280000')).toBe(9); // ₹3,050 vs ₹2,800 → +9%
    expect(pctAboveReserve('280000', '280000')).toBe(0);
    expect(pctAboveReserve('252000', '280000')).toBe(-10);
    expect(pctAboveReserve('305000', null)).toBeNull();
    expect(pctAboveReserve('305000', '0')).toBeNull();
  });
});

describe('Create Auction draft (screen 64)', () => {
  const now = Date.parse('2026-06-30T15:30:00Z');
  it('builds a valid english-open auction: reserve seeds open+reserve, increment→minor, endsAt from duration', () => {
    const d = buildCreateAuctionDraft({ listingId: 'l1', reserveRupees: '2800', incrementRupees: '50', hours: 6 }, now);
    expect(d.ok).toBe(true);
    expect(d.input!.startPriceMinor).toBe('280000');
    expect(d.input!.reservePriceMinor).toBe('280000');
    expect(d.input!.minIncrementMinor).toBe('5000');
    expect(d.input!.endsAt).toBe(auctionEndsAt(now, 6));
  });
  it('increment optional', () => {
    expect(buildCreateAuctionDraft({ listingId: 'l1', reserveRupees: '2800', hours: 2 }, now).input!.minIncrementMinor).toBeUndefined();
  });
  it('rejects missing listing / bad reserve / bad duration', () => {
    expect(buildCreateAuctionDraft({ reserveRupees: '2800', hours: 6 }, now).reason).toBe('listing');
    expect(buildCreateAuctionDraft({ listingId: 'l1', reserveRupees: '0', hours: 6 }, now).reason).toBe('reserve');
    expect(buildCreateAuctionDraft({ listingId: 'l1', reserveRupees: 'abc', hours: 6 }, now).reason).toBe('reserve');
    expect(buildCreateAuctionDraft({ listingId: 'l1', reserveRupees: '2800', hours: 5 }, now).reason).toBe('duration');
  });
});

describe('My Bids buckets (screen 18)', () => {
  it('ongoing → active; decided → won/lost by isWinning', () => {
    expect(myBidBucket({ auctionStatus: 'live', isWinning: true })).toBe('active');
    expect(myBidBucket({ auctionStatus: 'extended', isWinning: false })).toBe('active');
    expect(myBidBucket({ auctionStatus: 'ended', isWinning: true })).toBe('won');
    expect(myBidBucket({ auctionStatus: 'settled', isWinning: false })).toBe('lost');
    expect(matchesMyBidTab({ auctionStatus: 'ended', isWinning: true }, 'won')).toBe(true);
  });
  it('counts each bucket', () => {
    const bids = [
      { auctionStatus: 'live', isWinning: true }, { auctionStatus: 'live', isWinning: false },
      { auctionStatus: 'ended', isWinning: true }, { auctionStatus: 'settled', isWinning: false },
      { auctionStatus: 'cancelled', isWinning: false },
    ];
    expect(myBidCounts(bids)).toEqual({ active: 2, won: 1, lost: 2 });
  });
});

describe('bid-sheet money (screen 17)', () => {
  it('bidAmountMinor = per-unit × qty as bigint', () => {
    expect(bidAmountMinor('1480000', 2)).toBe('2960000'); // ₹14,800/qtl × 2 = ₹29,600
    expect(bidAmountMinor('1480000', 0)).toBe('0');
    expect(bidAmountMinor('bad', 2)).toBe('0');
  });
  it('emdHoldMinor: flat returns the amount, pct floors a bps share, none → 0', () => {
    expect(emdHoldMinor({ kind: 'flat', minor: '50000' }, '2960000')).toBe('50000');
    expect(emdHoldMinor({ kind: 'pct', pctBps: 200 }, '2960000')).toBe('59200'); // 2% of ₹29,600
    expect(emdHoldMinor({ kind: 'none' }, '2960000')).toBe('0');
  });
  it('walletCoversHold compares available ≥ hold', () => {
    expect(walletCoversHold('1245000', '50000')).toBe(true);
    expect(walletCoversHold('40000', '50000')).toBe(false);
    expect(walletCoversHold('bad', '1')).toBe(false);
  });
});
import type { BidHistoryItem } from '@krishalaya/sdk-js';

const bid = (over: Partial<BidHistoryItem>): BidHistoryItem => ({ id: 'b', bidderUserId: 'u', amountMinor: '10000', createdAt: '2026-06-01T00:00:00Z', ...over });

describe('timeLeft', () => {
  const now = Date.parse('2026-06-30T10:00:00Z');
  it('breaks the remainder into d/h/m', () => {
    expect(timeLeft('2026-06-30T12:14:00Z', now)).toEqual({ ended: false, totalMs: (2 * 60 + 14) * 60000, days: 0, hours: 2, minutes: 14 });
    expect(timeLeft('2026-07-02T11:00:00Z', now)).toMatchObject({ ended: false, days: 2, hours: 1, minutes: 0 });
  });
  it('marks ended when past or unparseable', () => {
    expect(timeLeft('2026-06-30T09:59:00Z', now).ended).toBe(true);
    expect(timeLeft('nope', now).ended).toBe(true);
  });
});

describe('bidStats', () => {
  it('counts distinct bidders + visible bids and finds the top (leading) bidder', () => {
    const bids = [bid({ id: '1', bidderUserId: 'a', amountMinor: '14500' }), bid({ id: '2', bidderUserId: 'b', amountMinor: '14200' }), bid({ id: '3', bidderUserId: 'a', amountMinor: '14000' })];
    expect(bidStats(bids)).toEqual({ bidders: 2, bids: 3, topBidderId: 'a' });
    expect(bidStats([])).toEqual({ bidders: 0, bids: 0, topBidderId: null });
  });
  it('skips masked amounts when picking the leader', () => {
    const bids = [bid({ id: '1', bidderUserId: 'x', amountMinor: null }), bid({ id: '2', bidderUserId: 'y', amountMinor: '100' })];
    expect(bidStats(bids).topBidderId).toBe('y');
  });
});

describe('auctionStatusTone / isBiddable', () => {
  it('maps status → tone and biddability', () => {
    expect(auctionStatusTone('live')).toBe('success');
    expect(auctionStatusTone('scheduled')).toBe('info');
    expect(auctionStatusTone('settled')).toBe('accent');
    expect(auctionStatusTone('failed_reserve')).toBe('danger');
    expect(isBiddable('live')).toBe(true);
    expect(isBiddable('extended')).toBe(true);
    expect(isBiddable('ended')).toBe(false);
    expect(isBiddable('scheduled')).toBe(false);
  });
});

describe('currentPriceMinor', () => {
  it('returns the highest visible bid, ignoring masked (null) amounts', () => {
    const bids = [bid({ amountMinor: '15000' }), bid({ amountMinor: null }), bid({ amountMinor: '12000' })];
    expect(currentPriceMinor({ startPriceMinor: '10000' }, bids)).toBe('15000');
  });
  it('falls back to the start price when there are no visible bids', () => {
    expect(currentPriceMinor({ startPriceMinor: '10000' }, [])).toBe('10000');
    expect(currentPriceMinor({ startPriceMinor: '10000' }, [bid({ amountMinor: null })])).toBe('10000');
  });
  it('never returns below the start price', () => {
    expect(currentPriceMinor({ startPriceMinor: '10000' }, [bid({ amountMinor: '5000' })])).toBe('10000');
  });
  it('handles very large amounts without float loss', () => {
    expect(currentPriceMinor({ startPriceMinor: '1' }, [bid({ amountMinor: '9007199254740993000' })])).toBe('9007199254740993000');
  });
});

describe('minNextBidMinor', () => {
  it('adds the increment (bigint)', () => {
    expect(minNextBidMinor('15000', '500')).toBe('15500');
  });
});

describe('validateBidRupees', () => {
  it('accepts a bid ≥ the minimum next bid', () => {
    expect(validateBidRupees('200', '15500')).toEqual({ ok: true }); // 200₹ = 20000 ≥ 15500
  });
  it('rejects a bid below the minimum', () => {
    expect(validateBidRupees('150', '15500')).toEqual({ ok: false, reason: 'too_low' }); // 15000 < 15500
  });
  it('rejects non-integer / empty input', () => {
    expect(validateBidRupees('12.5', '100')).toEqual({ ok: false, reason: 'invalid' });
    expect(validateBidRupees('', '100')).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('emdRequirement (P1-8)', () => {
  it('prefers a flat emdMinor when > 0', () => {
    expect(emdRequirement({ emdMinor: '50000', emdPctBps: 200 })).toEqual({ kind: 'flat', minor: '50000' });
    expect(emdRequirement({ emdMinor: '9007199254740993', emdPctBps: null })).toEqual({ kind: 'flat', minor: '9007199254740993' });
  });
  it('falls back to a percentage when there is no flat amount', () => {
    expect(emdRequirement({ emdMinor: '0', emdPctBps: 500 })).toEqual({ kind: 'pct', pctBps: 500 });
  });
  it('returns none when neither is set', () => {
    expect(emdRequirement({ emdMinor: '0', emdPctBps: null })).toEqual({ kind: 'none' });
    expect(emdRequirement({ emdMinor: '0', emdPctBps: 0 })).toEqual({ kind: 'none' });
  });
  it('degrades a non-numeric emdMinor to none/pct (never throws)', () => {
    expect(emdRequirement({ emdMinor: 'x', emdPctBps: null })).toEqual({ kind: 'none' });
    expect(emdRequirement({ emdMinor: 'x', emdPctBps: 300 })).toEqual({ kind: 'pct', pctBps: 300 });
  });
});

describe('isOutbid', () => {
  it('true when I have bid but the top visible bid is someone else', () => {
    const bids = [bid({ bidderUserId: 'other', amountMinor: '20000' }), bid({ bidderUserId: 'me', amountMinor: '15000' })];
    expect(isOutbid(bids, 'me')).toBe(true);
  });
  it('false when I am the top bidder', () => {
    const bids = [bid({ bidderUserId: 'me', amountMinor: '20000' }), bid({ bidderUserId: 'other', amountMinor: '15000' })];
    expect(isOutbid(bids, 'me')).toBe(false);
  });
  it('false when I have not bid at all', () => {
    expect(isOutbid([bid({ bidderUserId: 'other' })], 'me')).toBe(false);
  });
});
