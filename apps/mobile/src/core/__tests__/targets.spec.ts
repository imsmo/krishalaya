// Unit tests for the PURE Ambassador Targets derivations (features/ambassador/targets, screen 169). Progress is
// computed only from real feeds; metrics with no feed degrade to achieved=null (never a fabricated count).
import { withinPeriod, progressPct, remaining, daysLeft, onboardsAchieved, visitsAchieved, earningsAchievedMinor, targetProgress, monthPeriodOffset, clampGoal } from '../../features/ambassador/targets';
import type { AmbassadorTarget, Referral, AmbassadorVisit, AmbassadorEarning } from '@krishalaya/sdk-js';

const START = '2026-08-01';
const END = '2026-08-31';
const ref = (status: string, createdAt: string): Referral => ({ id: status + createdAt, referrerUserId: 'a', refereeUserId: 'f', code: 'X', status, createdAt });
const visit = (visitedAt: string): AmbassadorVisit => ({ id: visitedAt, ambassadorId: 'a', visitedUserId: 'f', purpose: 'onboard', notes: null, lat: null, lng: null, regionId: null, visitedAt });
const earn = (amountMinor: string, createdAt: string, payoutId: string | null = null): AmbassadorEarning => ({ id: amountMinor + createdAt, ambassadorId: 'a', eventCode: 'referral_bonus', referenceType: null, referenceId: null, amountMinor, payoutId, createdAt });

describe('withinPeriod', () => {
  it('includes the whole end day and excludes outside', () => {
    expect(withinPeriod('2026-08-01T00:00:00Z', START, END)).toBe(true);
    expect(withinPeriod('2026-08-31T23:00:00Z', START, END)).toBe(true);
    expect(withinPeriod('2026-07-31T23:00:00Z', START, END)).toBe(false);
    expect(withinPeriod('2026-09-01T12:00:00Z', START, END)).toBe(false);
    expect(withinPeriod(null, START, END)).toBe(false);
  });
});

describe('progressPct + remaining', () => {
  it('clamps and rounds', () => {
    expect(progressPct(12, 16)).toBe(75);
    expect(progressPct(20, 16)).toBe(100);
    expect(progressPct(0, 16)).toBe(0);
    expect(progressPct(5, 0)).toBe(0);
    expect(remaining(12, 16)).toBe(4);
    expect(remaining(20, 16)).toBe(0);
  });
});

describe('daysLeft', () => {
  it('counts whole days to the end of the end-day, clamped ≥ 0', () => {
    const now = Date.parse('2026-08-19T00:00:00Z'); // 12 days incl end day → to 2026-09-01
    expect(daysLeft(END, now)).toBe(13);
    expect(daysLeft(END, Date.parse('2026-09-05T00:00:00Z'))).toBe(0);
  });
});

describe('achieved feeds', () => {
  it('counts activated onboards in period only', () => {
    const refs = [ref('activated', '2026-08-05T00:00:00Z'), ref('pending', '2026-08-06T00:00:00Z'), ref('active', '2026-07-30T00:00:00Z'), ref('onboarded', '2026-08-20T00:00:00Z')];
    expect(onboardsAchieved(refs, START, END)).toBe(2); // activated(8/5) + onboarded(8/20); pending excluded, active out-of-period excluded
  });
  it('counts visits in period', () => {
    expect(visitsAchieved([visit('2026-08-10T00:00:00Z'), visit('2026-07-01T00:00:00Z')], START, END)).toBe(1);
  });
  it('sums positive credits in period, excluding payouts', () => {
    const e = [earn('20000', '2026-08-03T00:00:00Z'), earn('5000', '2026-08-04T00:00:00Z', 'payout1'), earn('10000', '2026-07-04T00:00:00Z')];
    expect(earningsAchievedMinor(e, START, END)).toBe('20000');
  });
});

describe('monthPeriodOffset', () => {
  const aug = Date.parse('2026-08-15T10:00:00Z');
  it('this / next / previous month bounds', () => {
    expect(monthPeriodOffset(aug, 0)).toEqual({ startIso: '2026-08-01', endIso: '2026-08-31' });
    expect(monthPeriodOffset(aug, 1)).toEqual({ startIso: '2026-09-01', endIso: '2026-09-30' });
    expect(monthPeriodOffset(aug, -1)).toEqual({ startIso: '2026-07-01', endIso: '2026-07-31' });
  });
  it('rolls over the year', () => {
    expect(monthPeriodOffset(Date.parse('2026-12-10T00:00:00Z'), 1)).toEqual({ startIso: '2027-01-01', endIso: '2027-01-31' });
  });
});

describe('clampGoal', () => {
  it('clamps to [0, max] and floors', () => {
    expect(clampGoal(18)).toBe(18);
    expect(clampGoal(-3)).toBe(0);
    expect(clampGoal(4.9)).toBe(4);
    expect(clampGoal(5000, 999)).toBe(999);
    expect(clampGoal(NaN)).toBe(0);
  });
});

describe('targetProgress', () => {
  const t = (metric: string, targetValue: string): AmbassadorTarget => ({ id: metric, ambassadorId: 'a', metric, periodStart: START, periodEnd: END, targetValue });
  it('onboardings → real achieved + pct', () => {
    const p = targetProgress(t('onboardings', '16'), { referrals: [ref('activated', '2026-08-05T00:00:00Z'), ref('activated', '2026-08-06T00:00:00Z')] });
    expect(p.achieved).toBe(2); expect(p.targetValue).toBe(16); expect(p.pct).toBe(13); expect(p.isMoney).toBe(false);
  });
  it('sales_facilitated → achieved null (degrade), pct 0', () => {
    const p = targetProgress(t('sales_facilitated', '10'), {});
    expect(p.achieved).toBeNull(); expect(p.pct).toBe(0);
  });
  it('earnings_minor → money progress from credits', () => {
    const p = targetProgress(t('earnings_minor', '400000'), { earnings: [earn('200000', '2026-08-03T00:00:00Z')] });
    expect(p.isMoney).toBe(true); expect(p.achievedMinor).toBe('200000'); expect(p.targetMinor).toBe('400000'); expect(p.pct).toBe(50);
  });
});
