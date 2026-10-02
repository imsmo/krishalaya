// modules/auctions/__tests__/tenant11a-auction-domain.spec.ts · PC-56 TENANT-11a — the pure rules (unit project).
// The money and the transactions are proven live in tenant11a-auction-truth.integration.spec.ts; this pins the domain.
import { Auction } from '../domain/auction.entity';
import { AUCTION_GROUPS, GROUP_STATUSES, AUCTION_STATUSES, canTransition, groupOf, isTerminal } from '../domain/auction.state';
import { AuctionEndedError, AuctionActNotAllowedError, InvalidAuctionError } from '../domain/auctions.errors';
import { AuctionEventType } from '../domain/auctions.events';
import { emdApplied, emdForLot, lotValueMinor, qtyMilli, milliToText, emdApplyKey, emdForfeitKey } from '../domain/lot';
import { bidderLabel, cleanReason, shortName } from '../domain/display';
import { decodeCursor, encodeCursor } from '../domain/cursor';

const T0 = new Date('2026-07-13T09:00:00Z');
const END = new Date('2026-07-13T10:00:00Z');
const mk = (over: Record<string, unknown> = {}) => Auction.create({ id: 'a1', tenantId: 't1', listingId: 'l1', kind: 'english_open', quantity: '200.000', unitCode: 'kg',
  startPriceMinor: 61000n, reservePriceMinor: 64000n, minIncrementMinor: 500n, emdMinor: 1_000_000n, startsAt: T0, endsAt: END, ...over } as never);
const win = (amountMinor: bigint) => ({ amountMinor, bidId: 'b1', bidderUserId: 'u1' });

describe('F-12 · the price is PER UNIT; the lot value is quantity × price (integers only)', () => {
  it('reads numeric text to thousandths and back, never a float', () => {
    expect(qtyMilli('200.000')).toBe(200000n); expect(qtyMilli('60')).toBe(60000n); expect(qtyMilli('12.5')).toBe(12500n);
    expect(milliToText(12500n)).toBe('12.500');
    expect(() => qtyMilli('-1')).toThrow(); expect(() => qtyMilli('1.2345')).toThrow();
  });
  it('W138: ₹655/kg on a 200 kg lot = ₹1,31,000; W139: 60 qtl × ₹7,240 = ₹4,34,400', () => {
    expect(lotValueMinor(65500n, '200.000')).toBe(13_100_000n);
    expect(lotValueMinor(724000n, '60')).toBe(43_440_000n);
    expect(mk().lotValue(65500n)).toBe(13_100_000n);
  });
  it('floors a fractional lot exactly as the order line does', () => { expect(lotValueMinor(333n, '0.5')).toBe(166n); });
  it('the EMD stays per LOT: flat first, else % of the LOT value of the first bid (F-27b)', () => {
    expect(emdForLot(65500n, '200', 1_000_000n, 200)).toBe(1_000_000n);
    expect(emdForLot(65500n, '200', 0n, 200)).toBe(262_000n);          // 2% of ₹1,31,000
    expect(emdForLot(65500n, '200', 0n, null)).toBe(0n);
  });
  it('never applies more EMD than the order is worth (the excess goes back)', () => {
    expect(emdApplied(5000n, 3000n)).toEqual({ applied: 3000n, excess: 2000n });
    expect(emdApplied(2500n, 434400n)).toEqual({ applied: 2500n, excess: 0n });
  });
  it('one ledger key per auction for the apply and the forfeit', () => {
    expect(emdApplyKey('A')).toBe('emd-apply:A'); expect(emdForfeitKey('A')).toBe('emd-forfeit:A');
  });
  it('refuses a lot with no quantity or unit, and a decision window over 72 h', () => {
    expect(() => mk({ quantity: '0' })).toThrow(InvalidAuctionError);
    expect(() => mk({ unitCode: '' })).toThrow(InvalidAuctionError);
    expect(() => mk({ decisionWindowHours: 73 })).toThrow(InvalidAuctionError);
  });
  it('the won event carries the per-unit hammer, the lot and its value', () => {
    const a = mk(); a.open(); a.closeBidding(END); a.resolve(win(65500n), 3, END);
    const won = a.pullEvents().find((e) => e.type === AuctionEventType.Won)!;
    expect(won.payload).toMatchObject({ unitPriceMinor: '65500', quantity: '200.000', unitCode: 'kg', lotValueMinor: '13100000', bidderUserId: 'u1' });
  });
});

describe('F-15 · a bid at or after ends_at is refused, and nothing revives a closed window', () => {
  it('refuses AUCTION_ENDED at and after the end, whatever the status says', () => {
    const a = mk(); a.open();
    expect(() => a.assertBidAcceptable(70000n, null, END)).toThrow(AuctionEndedError);
    expect(() => a.assertBidAcceptable(70000n, null, new Date(END.getTime() + 5000))).toThrow(AuctionEndedError);
    expect(() => a.assertBidAcceptable(70000n, null, new Date(END.getTime() - 1000))).not.toThrow();
  });
  it('anti-snipe extends only inside the live window', () => {
    const a = mk(); a.open();
    expect(a.maybeExtend(new Date(END.getTime() + 1000))).toBe(false);       // the old code set endsAt = now + 120s here
    expect(a.endsAt).toEqual(END);
    expect(a.maybeExtend(new Date(END.getTime() - 30_000))).toBe(true);
    expect(a.endsAt.getTime()).toBe(END.getTime() - 30_000 + 120_000);
  });
});

describe('F-13 · the seller-decision clock and the lapse', () => {
  it('closing into awaiting_approval sets decision_due_at = ended_at + window', () => {
    const a = mk({ requiresSellerApproval: true, decisionWindowHours: 8 }); a.open(); a.closeBidding(END); a.resolve(win(65500n), 2, END);
    expect(a.status).toBe('awaiting_approval');
    expect(a.toProps().decisionDueAt).toEqual(new Date(END.getTime() + 8 * 3600_000));
  });
  it('lapse() → ended, no sale; only from awaiting_approval', () => {
    const a = mk({ requiresSellerApproval: true }); a.open(); a.closeBidding(END); a.resolve(win(65500n), 2, END);
    a.lapse(new Date(END.getTime() + 25 * 3600_000));
    expect(a.status).toBe('ended'); expect(a.toProps().lapsedAt).not.toBeNull();
    expect(a.pullEvents().map((e) => e.type)).toContain(AuctionEventType.Lapsed);
    expect(() => mk().lapse()).toThrow(AuctionActNotAllowedError);
  });
});

describe('F-2 / F-16 · settled → defaulted; the order is attached once', () => {
  it('attachOrder only on a settled auction, once', () => {
    const a = mk(); a.open(); a.closeBidding(END); a.resolve(win(65500n), 3, END);
    a.attachOrder('o1'); a.attachOrder('o1');
    expect(a.toProps().settledOrderId).toBe('o1');
    expect(() => a.attachOrder('o2')).toThrow(InvalidAuctionError);
    a.markDefaulted(new Date());
    expect(a.status).toBe('defaulted'); expect(isTerminal('defaulted')).toBe(true);
  });
  it('the state machine: settled→defaulted and awaiting_approval→ended exist; nothing leaves defaulted', () => {
    expect(canTransition('settled', 'defaulted')).toBe(true);
    expect(canTransition('awaiting_approval', 'ended')).toBe(true);
    for (const s of AUCTION_STATUSES) expect(canTransition('defaulted', s)).toBe(false);
  });
  it('every status belongs to exactly one console tab', () => {
    for (const s of AUCTION_STATUSES) expect(AUCTION_GROUPS.filter((g) => GROUP_STATUSES[g].includes(s))).toHaveLength(1);
    expect(groupOf('extended')).toBe('live'); expect(groupOf('failed_reserve')).toBe('cancelled'); expect(groupOf('defaulted')).toBe('ended');
  });
});

describe('A11 · pause entry', () => {
  it('only while biddable; a second pause and a resume-without-pause are refused by name', () => {
    const a = mk(); expect(() => a.pauseEntry('admin')).toThrow(AuctionActNotAllowedError);
    a.open(); a.pauseEntry('admin');
    expect(a.toProps().entryPaused).toBe(true);
    expect(() => a.pauseEntry('admin')).toThrow(AuctionActNotAllowedError);
    a.resumeEntry(); expect(a.toProps().entryPaused).toBe(false);
    expect(() => a.resumeEntry()).toThrow(AuctionActNotAllowedError);
  });
  it('cancel records who and why', () => {
    const a = mk(); a.open(); a.cancel('admin', 'quality complaint on the lot', T0);
    expect(a.toProps()).toMatchObject({ status: 'cancelled', cancelledBy: 'admin', cancelReason: 'quality complaint on the lot' });
  });
});

describe('F-17 / F-25 · labels, names, reasons and µs cursors', () => {
  it('B1…Bn, short names, reasons bounded', () => {
    expect(bidderLabel(0)).toBe('B1'); expect(bidderLabel(3)).toBe('B4');
    expect(shortName('Ramesh Kumar Patel')).toBe('Ramesh P.'); expect(shortName('Ramesh')).toBe('Ramesh'); expect(shortName('  ')).toBeNull();
    expect(cleanReason('ok')).toBeNull(); expect(cleanReason('  quality issue  ')).toBe('quality issue'); expect(cleanReason('x'.repeat(301))).toBeNull();
  });
  it('a µs cursor round-trips every digit Postgres stored; junk is no cursor', () => {
    const c = encodeCursor('2026-07-13 09:00:00.123456+00', '0190a3b2-7c4d-7e8f-9a0b-1c2d3e4f5a6b')!;
    expect(decodeCursor(c)).toEqual({ c: '2026-07-13 09:00:00.123456+00', id: '0190a3b2-7c4d-7e8f-9a0b-1c2d3e4f5a6b' });
    expect(decodeCursor('not-a-cursor')).toBeUndefined();
  });
});
