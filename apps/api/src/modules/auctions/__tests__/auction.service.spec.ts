// modules/auctions/__tests__/auction.service.spec.ts · pure-domain unit tests: the auction_status
// state machine (Law 5) + the Auction aggregate (bid rules, anti-snipe, reserve, resolution).
import { canTransition, isBiddable, isTerminal, IllegalAuctionTransitionError, AUCTION_STATUSES, AuctionStatus } from '../domain/auction.state';
import { Auction } from '../domain/auction.entity';
import { AuctionEventType } from '../domain/auctions.events';
import { BidTooLowError, AuctionNotBiddableError, InvalidAuctionError } from '../domain/auctions.errors';

const base = { id: 'a1', tenantId: 't1', listingId: 'l1', quantity: '1', unitCode: 'lot', startsAt: new Date('2026-04-01T00:00:00Z'), endsAt: new Date('2026-04-02T00:00:00Z') };
const english = (over: any = {}) => Auction.create({ ...base, kind: 'english_open', startPriceMinor: 100000n, minIncrementMinor: 10000n, ...over });

describe('auction.state machine', () => {
  it('allows the documented transitions, forbids illegal ones', () => {
    expect(canTransition('scheduled', 'live')).toBe(true);
    expect(canTransition('live', 'extended')).toBe(true);
    expect(canTransition('ended', 'settled')).toBe(true);
    expect(canTransition('scheduled', 'settled')).toBe(false);
    expect(isBiddable('live')).toBe(true); expect(isBiddable('extended')).toBe(true); expect(isBiddable('ended')).toBe(false);
    expect(isTerminal('settled')).toBe(true); expect(isTerminal('cancelled')).toBe(true); expect(isTerminal('failed_reserve')).toBe(true);
  });
  it('covers every status without throwing', () => { for (const s of AUCTION_STATUSES) expect(() => canTransition(s, 'cancelled' as AuctionStatus)).not.toThrow(); });
});

describe('Auction.create', () => {
  it('rejects unsupported kinds, bad prices, and bad windows', () => {
    expect(() => Auction.create({ ...base, kind: 'dutch' as any, startPriceMinor: 100n })).toThrow(InvalidAuctionError);
    expect(() => english({ startPriceMinor: 0n })).toThrow(InvalidAuctionError);
    expect(() => english({ endsAt: base.startsAt })).toThrow(InvalidAuctionError);
    expect(() => english({ reservePriceMinor: 50000n })).toThrow(InvalidAuctionError);   // reserve < start
  });
  it('starts scheduled and emits created', () => {
    const a = english();
    expect(a.status).toBe('scheduled');
    expect(a.pullEvents().map((e) => e.type)).toContain(AuctionEventType.Created);
  });
});

describe('bid rules', () => {
  it('english: min next = start (no bids) then high + increment', () => {
    const a = english(); a.open();
    expect(a.minNextBidMinor(null)).toBe(100000n);
    expect(a.minNextBidMinor(120000n)).toBe(130000n);
    const inWindow = new Date('2026-04-01T12:00:00Z');
    expect(() => a.assertBidAcceptable(125000n, 120000n, inWindow)).toThrow(BidTooLowError);   // < high+increment
    a.assertBidAcceptable(130000n, 120000n, inWindow);                                          // ok
  });
  it('sealed: min is always the start price (no increment, no visibility)', () => {
    const s = Auction.create({ ...base, kind: 'sealed', startPriceMinor: 100000n }); s.open();
    expect(s.minNextBidMinor(999999n)).toBe(100000n);
    expect(() => s.assertBidAcceptable(90000n, null, new Date('2026-04-01T12:00:00Z'))).toThrow(BidTooLowError);
  });
  it('rejects bids when not biddable', () => {
    const a = english();   // still scheduled
    expect(() => a.assertBidAcceptable(200000n, null)).toThrow(AuctionNotBiddableError);
  });
  it('emdForBid: flat overrides percent', () => {
    expect(english({ emdMinor: 5000n }).emdForBid(1000000n)).toBe(5000n);
    expect(english({ emdPctBps: 1000 }).emdForBid(1000000n)).toBe(100000n);   // 10%
    expect(english().emdForBid(1000000n)).toBe(0n);
  });
});

describe('anti-snipe + resolution', () => {
  it('a bid within the trigger window extends the auction', () => {
    const now = new Date('2026-04-02T00:00:00Z');
    const a = english({ endsAt: new Date(now.getTime() + 30_000), autoExtendSecs: 120, extendTriggerSecs: 60 }); a.open(); a.pullEvents();
    expect(a.maybeExtend(now)).toBe(true);                 // 30s left < 60s trigger
    expect(a.status).toBe('extended');
    expect(a.endsAt.getTime()).toBe(now.getTime() + 120_000);
  });
  it('a bid with plenty of time does NOT extend', () => {
    const now = new Date('2026-04-01T12:00:00Z');
    const a = english(); a.open();
    expect(a.maybeExtend(now)).toBe(false);
  });
  it('resolve → failed_reserve when reserve unmet or no bids', () => {
    const a = english({ reservePriceMinor: 200000n }); a.open(); a.closeBidding();
    a.resolve({ amountMinor: 150000n, bidId: 'b1', bidderUserId: 'u1' }, 1);   // below reserve
    expect(a.status).toBe('failed_reserve');
    const b = english(); b.open(); b.closeBidding(); b.resolve(null, 0);
    expect(b.status).toBe('failed_reserve');
  });
  it('resolve → settled (or awaiting_approval) when reserve met', () => {
    const a = english({ reservePriceMinor: 120000n }); a.open(); a.closeBidding();
    a.resolve({ amountMinor: 150000n, bidId: 'b1', bidderUserId: 'u1' }, 1);
    expect(a.status).toBe('settled');
    expect(a.toProps().winningBidId).toBe('b1');
    expect(a.pullEvents().map((e) => e.type)).toContain(AuctionEventType.Won);

    const ap = english({ requiresSellerApproval: true }); ap.open(); ap.closeBidding();
    ap.resolve({ amountMinor: 150000n, bidId: 'b2', bidderUserId: 'u1' }, 1);
    expect(ap.status).toBe('awaiting_approval');
    ap.approve({ amountMinor: 150000n, bidId: 'b2', bidderUserId: 'u1' });
    expect(ap.status).toBe('settled');
  });
  it('min-bidders not met → failed_reserve', () => {
    const a = english({ minBidders: 3 }); a.open(); a.closeBidding();
    a.resolve({ amountMinor: 150000n, bidId: 'b1', bidderUserId: 'u1' }, 1);
    expect(a.status).toBe('failed_reserve');
  });
});
