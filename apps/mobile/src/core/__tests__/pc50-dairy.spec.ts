// PC-50 W10-2 · pure dairy-farmer logic. Pins the diary window math (local-calendar ISO, month pager),
// bill tones, and the dispute-window gate (open only while the SERVER's end instant is in the future).
import { defaultDiaryRange, shiftMonth, isValidRange, billTone, disputeWindowOpen } from '../../features/dairy/dairy';

describe('diary windows (local calendar, ISO dates)', () => {
  it('defaults to 1st-of-month → today and pages by whole months', () => {
    expect(defaultDiaryRange(new Date(2026, 7, 5))).toEqual({ from: '2026-08-01', to: '2026-08-05' });
    expect(shiftMonth('2026-08-01', -1)).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    expect(shiftMonth('2026-01-01', -1)).toEqual({ from: '2025-12-01', to: '2025-12-31' }); // year boundary
    expect(shiftMonth('2026-01-01', 1)).toEqual({ from: '2026-02-01', to: '2026-02-28' });  // Feb length
    expect(isValidRange('2026-08-01', '2026-08-05')).toBe(true);
    expect(isValidRange('2026-08-06', '2026-08-05')).toBe(false);
  });
});

describe('bill display gates', () => {
  it('tones follow the settlement lifecycle; dispute window compares INSTANTS (timezone-safe)', () => {
    expect(billTone('paid')).toBe('success');
    expect(billTone('disputed')).toBe('danger');
    expect(billTone('previewed')).toBe('warning');
    expect(billTone('draft')).toBe('neutral');
    const now = new Date('2026-08-05T10:00:00Z');
    expect(disputeWindowOpen('2026-08-05T12:00:00Z', now)).toBe(true);
    expect(disputeWindowOpen('2026-08-05T09:00:00Z', now)).toBe(false);
    expect(disputeWindowOpen(null, now)).toBe(false);
  });
});
