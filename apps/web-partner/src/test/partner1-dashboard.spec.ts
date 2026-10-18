// apps/web-partner/src/test/partner1-dashboard.spec.ts · PC-56 PARTNER-1a · founder D1 — the dashboard's PRESENTATIONAL maths
// (features/partner1/dashboard.ts): integer arithmetic only — bps → one-decimal percent, seconds → one-decimal hours, bigint sums, the age
// against the SERVER's computedAt, the as-of text in India time, and which state a failure is (F-7: OFF is "switched off", never an outage).
import { ageHours, appRef, asOfText, bpsPercentText, dashboardState, failureOf, fpoLabel, hoursText, sumMinor } from '../features/partner1/dashboard';

describe('PC-56 PARTNER-1a · the dashboard maths (pure)', () => {
  it('bps → percent text with one decimal, integer arithmetic, half-up; null stays null; a float bps is refused', () => {
    expect(bpsPercentText(7100)).toBe('71.0');
    expect(bpsPercentText(6666)).toBe('66.7');
    expect(bpsPercentText(9640)).toBe('96.4');
    expect(bpsPercentText(10000)).toBe('100.0');
    expect(bpsPercentText(4)).toBe('0.0');
    expect(bpsPercentText(5)).toBe('0.1');
    expect(bpsPercentText(null)).toBeNull();
    expect(() => bpsPercentText(71.5)).toThrow(/basis points/);
    for (let b = 0; b <= 10000; b += 37) expect(bpsPercentText(b)).toMatch(/^\d{1,3}\.\d$/);
  });
  it('seconds → hours text, one decimal; age in whole hours from the SERVER instant; a short reference, never an LA-number', () => {
    expect(hoursText(5400)).toBe('1.5'); expect(hoursText(3600 * 31)).toBe('31.0'); expect(hoursText(0)).toBe('0.0'); expect(hoursText(null)).toBeNull();
    expect(() => hoursText(1.5)).toThrow();
    expect(ageHours('2026-10-16T00:00:00.000Z', '2026-10-18T06:59:59.000Z')).toBe(54);
    expect(ageHours('2026-10-18T07:00:00.000Z', '2026-10-18T06:00:00.000Z')).toBe(0);
    expect(appRef('0192d2c4-1111-7000-8000-000000000001')).toBe('0192d2c4…');
  });
  it('money sums are bigint minor-unit strings past 2^53', () => {
    expect(sumMinor(['9007199254740993', '7', null])).toBe('9007199254741000');
  });
  it('the as-of text is India time whatever the zone', () => {
    expect(asOfText('2026-10-17T20:30:00.000Z', 'en')).toMatch(/18 Oct 2026|Oct 18, 2026/);
  });
  it('an organisation that is not live reads as the neutral word', () => {
    expect(fpoLabel(null, 'an organisation')).toBe('an organisation'); expect(fpoLabel('  ', 'x')).toBe('x'); expect(fpoLabel('Fixture FPO', 'x')).toBe('Fixture FPO');
  });
  it('F-7: a 404 while the flag map says OFF is "off"; every other failure is "error"; an empty book is "empty"', () => {
    expect(failureOf(404, 'off')).toBe('off');
    expect(failureOf(404, 'on')).toBe('error'); expect(failureOf(404, 'unknown')).toBe('error'); expect(failureOf(500, 'off')).toBe('error'); expect(failureOf(undefined, 'off')).toBe('error');
    expect(dashboardState(null, 'off')).toBe('off'); expect(dashboardState(null, null)).toBe('error');
    expect(dashboardState({ applicationsTotal: 0, portfolio: { activeLoans: 0 } }, null)).toBe('empty');
    expect(dashboardState({ applicationsTotal: 1, portfolio: { activeLoans: 0 } }, null)).toBe('ok');
  });
});
