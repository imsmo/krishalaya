// modules/partner-console/__tests__/partner1a-dashboard.spec.ts · PC-56 PARTNER-1a · founder D1 — the dashboard's arithmetic, PURE.
// A rate is an integer number of basis points (never a float, never NaN); money sums are bigint minor-unit strings; the latency
// percentiles are nearest-rank (an observed value); the SLA promise is `sla.decision_hours` or null. (M4 kills here.)
import { BPS_SCALE, DASHBOARD_WINDOWS, percentileNearestRank, rateBps, slaDecisionHours, sumMinor, withinPromise } from '../domain/partner-dashboard.rules';

describe('PC-56 PARTNER-1a · the dashboard arithmetic (founder D1)', () => {
  it('a rate is floor(n × 10 000 ÷ d) basis points — an INTEGER, exact for odd ratios; null when nothing is in the denominator', () => {
    expect(BPS_SCALE).toBe(10_000n);
    expect(rateBps(71, 100)).toBe(7100);
    expect(rateBps(2, 3)).toBe(6666);               // 0.6666… → 6666 bps (floor), never 6666.67
    expect(rateBps(1, 7)).toBe(1428);
    expect(rateBps(104, 105)).toBe(9904);
    expect(rateBps('5', '5')).toBe(10000);
    expect(rateBps(0, 9)).toBe(0);
    expect(rateBps(0, 0)).toBeNull();
    expect(rateBps(3, 0)).toBeNull();
    for (const [n, d] of [[1, 3], [2, 7], [999, 1000], [13, 17], [123456789, 987654321]] as const) {
      const v = rateBps(n, d) as number;
      expect(Number.isInteger(v)).toBe(true);
      expect(Number.isNaN(v)).toBe(false);
    }
  });
  it('money adds as bigint minor-unit strings, past 2^53', () => {
    expect(sumMinor(['9007199254740993', '10'])).toBe('9007199254741003');
    expect(sumMinor(['0', null, undefined, ''])).toBe('0');
    expect(typeof sumMinor(['1', '2'])).toBe('string');
  });
  it('latency percentiles are nearest-rank observed values; empty → null', () => {
    expect(percentileNearestRank([], 50)).toBeNull();
    expect(percentileNearestRank([30], 90)).toBe(30);
    expect(percentileNearestRank([40, 10, 30, 20], 50)).toBe(20);
    expect(percentileNearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentileNearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentileNearestRank([5, 1, 3], 50)).toBe(3);
  });
  it('the SLA promise is sla.decision_hours (a whole number ≥ 1) or null; within-promise counts ≤ the promise', () => {
    expect(slaDecisionHours({ decision_hours: 48 })).toBe(48);
    expect(slaDecisionHours({ decision_hours: 48, note: 'kept' })).toBe(48);
    for (const bad of [{}, null, undefined, { decision_hours: 0 }, { decision_hours: 1.5 }, { decision_hours: '48' }, { decisionHours: 48 }]) expect(slaDecisionHours(bad)).toBeNull();
    expect(withinPromise([3600, 7200, 7201], 2)).toBe(2);
    expect(withinPromise([3600], null)).toBeNull();
  });
  it('the month boundary is the database\'s IST calendar month, never a process clock or an hour literal', () => {
    expect(DASHBOARD_WINDOWS.monthBoundarySql).toBe(`date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`);
    expect(DASHBOARD_WINDOWS.latencyDays).toBe(30); expect(DASHBOARD_WINDOWS.onTimeDays).toBe(90);
  });
});
