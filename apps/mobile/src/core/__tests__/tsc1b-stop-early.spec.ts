// apps/mobile/src/core/__tests__/tsc1b-stop-early.spec.ts · PC-56 TSC-1b (brief_tsc1b.md C, founder: "Before live, with a reason").
// The pure gate and reason check behind the seller's Stop Early, pinned to the server's rules (apps/api auctions:
// AuctionService.cancel lets the seller cancel only `scheduled`; live/extended need auction.cancel_live; the reason is 3–300
// characters after trim — dto/auction-act.dto.ts + domain/display.ts cleanReason), and the data layer passing the reason on.
import { canStopEarly, checkStopReason, STOP_EARLY_STATUSES, STOP_REASON_MIN, STOP_REASON_MAX } from '../../features/auctions/auction-status';
import { cancelAuction } from '../../features/auctions/auctions.api';

const mockCancel = jest.fn();
jest.mock('../util/ids', () => ({ newId: () => 'id-1' }));
jest.mock('../api/client', () => ({ apiClient: () => ({ auctions: { cancel: (...a: unknown[]) => mockCancel(...a) } }) }));

describe('canStopEarly — only before the auction is live', () => {
  it('scheduled is the only stoppable status', () => {
    expect(STOP_EARLY_STATUSES).toEqual(['scheduled']);
    expect(canStopEarly('scheduled')).toBe(true);
  });
  it.each(['live', 'extended', 'ended', 'awaiting_approval', 'settled', 'cancelled', 'failed_reserve', 'defaulted', '', 'SCHEDULED'])('%s → not stoppable', (s) => {
    expect(canStopEarly(s)).toBe(false);
  });
});

describe('checkStopReason — the server limits, after trim', () => {
  it('limits are 3 and 300', () => { expect([STOP_REASON_MIN, STOP_REASON_MAX]).toEqual([3, 300]); });
  it.each([[''], ['  '], ['ab'], ['  ab  '], [null], [undefined]])('%j → short', (v) => {
    expect(checkStopReason(v as string)).toEqual({ ok: false, why: 'short' });
  });
  it('3 characters (after trim) is enough, and the trimmed reason is returned', () => {
    expect(checkStopReason('  abc ')).toEqual({ ok: true, reason: 'abc' });
  });
  it('300 is allowed; 301 is too long', () => {
    expect(checkStopReason('x'.repeat(300))).toEqual({ ok: true, reason: 'x'.repeat(300) });
    expect(checkStopReason('x'.repeat(301))).toEqual({ ok: false, why: 'long' });
    expect(checkStopReason(`  ${'x'.repeat(300)}  `)).toEqual({ ok: true, reason: 'x'.repeat(300) });
  });
});

describe('cancelAuction passes the reason to the sdk', () => {
  it('calls auctions.cancel(id, reason)', async () => {
    mockCancel.mockResolvedValue({ auctionId: 'a1', status: 'cancelled', notified: 2 });
    await expect(cancelAuction('a1', 'sold at the farm gate')).resolves.toEqual({ auctionId: 'a1', status: 'cancelled', notified: 2 });
    expect(mockCancel).toHaveBeenCalledWith('a1', 'sold at the farm gate');
  });
});
