// apps/web-admin/src/test/report.spec.ts · unit tests for the pure report helpers: float-free bps→percent + the
// window/currency query normaliser.
import { bpsToPercent, buildReportQuery } from '../features/reports/report';

describe('bpsToPercent (integer math, no float)', () => {
  it('formats basis points as 2-decimal percent', () => {
    expect(bpsToPercent(10000)).toBe('100.00%');
    expect(bpsToPercent(9850)).toBe('98.50%');
    expect(bpsToPercent(5)).toBe('0.05%');
    expect(bpsToPercent(0)).toBe('0.00%');
  });
  it('guards non-finite / negative', () => {
    expect(bpsToPercent(NaN)).toBe('0.00%');
    expect(bpsToPercent(-100)).toBe('0.00%');
  });
});

describe('buildReportQuery', () => {
  it('defaults currency to INR and drops blank window', () => {
    expect(buildReportQuery({})).toEqual({ currency: 'INR' });
  });
  it('accepts a valid ISO-4217 currency (upper-cased)', () => {
    expect(buildReportQuery({ currency: 'usd' })).toEqual({ currency: 'USD' });
    expect(buildReportQuery({ currency: 'rupees' })).toEqual({ currency: 'INR' });
  });
  it('normalises valid ISO from/to and drops invalid ones', () => {
    const r = buildReportQuery({ from: '2026-01-01T00:00', to: 'nope' });
    // TZ-independent (PC-29 fix: the old /^2026-01-01T/ assertion only passed with TZ=UTC — datetime-local
    // inputs parse as LOCAL time, so the ISO date can differ): compare instants, not string prefixes.
    expect(new Date(r.from as string).getTime()).toBe(new Date('2026-01-01T00:00').getTime());
    expect(r.to).toBeUndefined();
  });
});
