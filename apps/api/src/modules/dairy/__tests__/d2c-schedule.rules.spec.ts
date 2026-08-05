// PC-55 A5 · the schedule + billing rules. These decide whether a household is charged for milk on a given
// morning, so every case below is a case where getting it wrong would take money from a family unfairly.
import { isDueOn, isPaused, shouldSchedule, horizonDays, daysBetween, canSettleDelivery, isBillable, statementTotalMinor } from '../domain/d2c-schedule.rules';

const sub = (over: Partial<{ frequency: 'daily' | 'alternate_day' | 'weekly' | 'monthly'; startsOn: string; status: string; pausedUntil: string | null }> = {}) =>
  ({ id: 's1', frequency: 'daily' as const, startsOn: '2026-08-01', status: 'active', pausedUntil: null, ...over });

describe('cadence', () => {
  it('daily lands every day from the start date, never before it', () => {
    expect(isDueOn('daily', '2026-08-01', '2026-08-01')).toBe(true);
    expect(isDueOn('daily', '2026-08-01', '2026-08-09')).toBe(true);
    expect(isDueOn('daily', '2026-08-01', '2026-07-31')).toBe(false);   // before the household subscribed
  });
  it('alternate_day counts from the start date (not from calendar parity)', () => {
    expect(isDueOn('alternate_day', '2026-08-01', '2026-08-01')).toBe(true);
    expect(isDueOn('alternate_day', '2026-08-01', '2026-08-02')).toBe(false);
    expect(isDueOn('alternate_day', '2026-08-01', '2026-08-03')).toBe(true);
    expect(isDueOn('alternate_day', '2026-08-02', '2026-08-03')).toBe(false);  // a different start shifts it
  });
  it('weekly holds the start weekday across a month boundary', () => {
    expect(isDueOn('weekly', '2026-08-01', '2026-08-08')).toBe(true);
    expect(isDueOn('weekly', '2026-08-01', '2026-09-05')).toBe(true);   // 35 days later
    expect(isDueOn('weekly', '2026-08-01', '2026-08-09')).toBe(false);
  });
  it('monthly bills the same day-of-month, and short months bill on their LAST day instead of skipping', () => {
    expect(isDueOn('monthly', '2026-01-31', '2026-02-28')).toBe(true);  // Feb has no 31st → last day
    expect(isDueOn('monthly', '2026-01-31', '2026-03-31')).toBe(true);
    expect(isDueOn('monthly', '2026-01-15', '2026-02-15')).toBe(true);
    expect(isDueOn('monthly', '2026-01-15', '2026-02-14')).toBe(false);
  });
  it('daysBetween is UTC-midnight based, so a DST shift can never move a delivery day', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });
});

describe('pause & status (the never-charge-a-paused-household rules)', () => {
  it('pause is INCLUSIVE of paused_until — that day is still off', () => {
    expect(isPaused('2026-08-10', '2026-08-10')).toBe(true);
    expect(isPaused('2026-08-10', '2026-08-11')).toBe(false);
    expect(isPaused(null, '2026-08-10')).toBe(false);
  });
  it('only ACTIVE, started, unpaused subscriptions ever produce a drop', () => {
    expect(shouldSchedule(sub(), '2026-08-05')).toBe(true);
    expect(shouldSchedule(sub({ status: 'paused' }), '2026-08-05')).toBe(false);
    expect(shouldSchedule(sub({ status: 'cancelled' }), '2026-08-05')).toBe(false);
    expect(shouldSchedule(sub({ pausedUntil: '2026-08-06' }), '2026-08-05')).toBe(false);
    expect(shouldSchedule(sub({ pausedUntil: '2026-08-04' }), '2026-08-05')).toBe(true);   // pause has expired
    expect(shouldSchedule(sub({ startsOn: '2026-08-10' }), '2026-08-05')).toBe(false);
  });
});

describe('horizon', () => {
  it('includes today through today+N inclusive', () => {
    expect(horizonDays('2026-08-05', 2)).toEqual(['2026-08-05', '2026-08-06', '2026-08-07']);
    expect(horizonDays('2026-08-31', 1)).toEqual(['2026-08-31', '2026-09-01']);   // month rollover
  });
});

describe('settlement & billing', () => {
  it('a settled drop is never re-settled (money follows this outcome)', () => {
    expect(canSettleDelivery('scheduled')).toBe(true);
    expect(canSettleDelivery('delivered')).toBe(false);
    expect(canSettleDelivery('skipped')).toBe(false);
    expect(canSettleDelivery('failed')).toBe(false);
    expect(canSettleDelivery('refunded')).toBe(false);
  });
  it('ONLY delivered is billable — a skipped or failed drop never enters a statement', () => {
    expect(isBillable('delivered')).toBe(true);
    expect(isBillable('skipped')).toBe(false);
    expect(isBillable('failed')).toBe(false);
    expect(isBillable('scheduled')).toBe(false);
    expect(isBillable('refunded')).toBe(false);
  });
  it('statement arithmetic is exact integer minor-unit math (Law 2)', () => {
    expect(statementTotalMinor(31, '6000')).toBe('186000');       // ₹60/day × 31 days = ₹1,860
    expect(statementTotalMinor(0, '6000')).toBe('0');
    // a million households on a ₹60 plan: still exact, where a float would drift
    expect(statementTotalMinor(1000000, '6000')).toBe('6000000000');
    expect(() => statementTotalMinor(5, '60.00')).toThrow();      // refuses a non-minor figure outright
  });
});
