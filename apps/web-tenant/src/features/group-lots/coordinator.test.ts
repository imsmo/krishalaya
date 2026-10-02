// apps/web-tenant/src/features/group-lots/coordinator.test.ts · the pure quantity helpers (PC-56 TENANT-11c). The settlement
// preview this file used to pin is gone with the typed-gross route it mirrored; shares are the API's.
import { canPledge, formatQtyMilli, parseQtyMilli, progressBps } from './coordinator';

describe('group-lots coordinator helpers', () => {
  it('quantities are integer milli-units, never floats', () => {
    expect(parseQtyMilli('12.5')).toBe(12500n);
    expect(parseQtyMilli('0.1') + parseQtyMilli('0.2')).toBe(300n);
    expect(formatQtyMilli(86000n)).toBe('86.000');
    expect(() => parseQtyMilli('1.2345')).toThrow();
    expect(() => parseQtyMilli('-1')).toThrow();
  });
  it('progress in basis points, clamped', () => {
    expect(progressBps('86', '100')).toBe(8600);
    expect(progressBps('120', '100')).toBe(10000);
    expect(progressBps('1', '0')).toBe(0);
  });
  it('a lot takes pledges only while pledging and before the deadline', () => {
    const now = new Date('2026-07-12T00:00:00Z');
    expect(canPledge('pledging', '2026-07-13T06:30:00Z', now)).toBe(true);
    expect(canPledge('pledging', '2026-07-11T06:30:00Z', now)).toBe(false);
    expect(canPledge('ready', '2026-07-13T06:30:00Z', now)).toBe(false);
  });
});
