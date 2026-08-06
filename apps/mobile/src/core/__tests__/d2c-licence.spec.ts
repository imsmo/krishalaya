// apps/mobile/src/core/__tests__/d2c-licence.spec.ts · PC-55 B6. The household's standing order and the
// shopkeeper's licence countdown — two places where a comfortable default costs somebody money or a lapsed trade.
import {
  D2C_STATUSES, D2C_FREQUENCIES, isD2cStatus, isD2cFrequency,
  buildSubscribe, buildPause, canPause, canResume, canCancel, subscriptionState, billableCount, daysAhead,
} from '../../features/dairy/d2c';
import { EXPIRY_WINDOW_DAYS, expiryState, daysUntil, sortByExpiry, actionableCount } from '../../features/store-owner/licence';

const TODAY = '2026-08-06';
const PLAN = '00000000-0000-7000-8000-0000000000p1'.replace('p1', 'a1');
const ADDR = '00000000-0000-7000-8000-0000000000a2';

describe('D2C vocabularies mirror the API', () => {
  it('statuses and frequencies are exactly what the server stores', () => {
    expect([...D2C_STATUSES]).toEqual(['active', 'paused', 'cancelled']);
    expect([...D2C_FREQUENCIES]).toEqual(['daily', 'alternate_day', 'weekly', 'monthly']);
    expect(isD2cStatus('paused')).toBe(true);
    expect(isD2cStatus('stopped')).toBe(false);
    expect(isD2cFrequency('fortnightly')).toBe(false);
  });
});

describe('buildSubscribe — a delivery cannot be arranged for a day that has passed', () => {
  const base = { planId: PLAN, addressId: ADDR, startsOn: TODAY };
  it('accepts today and any future start', () => {
    expect(buildSubscribe(base, TODAY)).toEqual({ ok: true, value: { planId: PLAN, addressId: ADDR, startsOn: TODAY } });
    expect(buildSubscribe({ ...base, startsOn: '2026-09-01' }, TODAY).ok).toBe(true);
  });
  it('refuses a back-dated start (the cadence job materialises drops FORWARD — a past start would bill for drops that never happened)', () => {
    expect(buildSubscribe({ ...base, startsOn: '2026-08-05' }, TODAY)).toEqual({ ok: false, error: 'startsOnPast' });
  });
  it('refuses a missing plan, a missing address and a malformed date', () => {
    expect(buildSubscribe({ ...base, planId: '' }, TODAY)).toEqual({ ok: false, error: 'plan' });
    expect(buildSubscribe({ ...base, addressId: 'home' }, TODAY)).toEqual({ ok: false, error: 'address' });
    expect(buildSubscribe({ ...base, startsOn: '06-08-2026' }, TODAY)).toEqual({ ok: false, error: 'startsOn' });
  });
});

describe('the three controls the household owns', () => {
  it('each is offered only in the state the API accepts', () => {
    expect(canPause('active')).toBe(true);
    expect(canPause('paused')).toBe(false);
    expect(canResume('paused')).toBe(true);
    expect(canResume('active')).toBe(false);
    expect(canCancel('active')).toBe(true);
    expect(canCancel('paused')).toBe(true);
  });
  it('a cancelled subscription offers NOTHING — cancellation is final, and offering cancel again would imply it is not', () => {
    expect(canPause('cancelled')).toBe(false);
    expect(canResume('cancelled')).toBe(false);
    expect(canCancel('cancelled')).toBe(false);
  });
});

describe('buildPause — a pause needs an end, or it is an abandoned subscription', () => {
  it('requires a future end date', () => {
    expect(buildPause({ pausedUntil: '2026-08-20' }, TODAY)).toEqual({ ok: true, value: { pausedUntil: '2026-08-20' } });
    expect(buildPause({ pausedUntil: TODAY }, TODAY)).toEqual({ ok: false, error: 'pausedUntilPast' });
    expect(buildPause({ pausedUntil: '2026-08-05' }, TODAY)).toEqual({ ok: false, error: 'pausedUntilPast' });
    expect(buildPause({ pausedUntil: '' }, TODAY)).toEqual({ ok: false, error: 'pausedUntil' });
  });
  it('caps a pause at about a year — beyond that it is a cancellation being avoided', () => {
    expect(buildPause({ pausedUntil: '2027-08-05' }, TODAY).ok).toBe(true);      // 364 days
    expect(buildPause({ pausedUntil: '2027-09-01' }, TODAY)).toEqual({ ok: false, error: 'pausedUntilFar' });
    expect(daysAhead(TODAY, '2026-08-20')).toBe(14);
  });
});

describe('subscriptionState — what the household reads at a glance', () => {
  it('tells a dated pause from a plain one, and names the last day of a pause', () => {
    expect(subscriptionState({ status: 'paused', pausedUntil: '2026-08-20' }, TODAY)).toBe('paused_until');
    expect(subscriptionState({ status: 'paused', pausedUntil: TODAY }, TODAY)).toBe('resuming_today');
    expect(subscriptionState({ status: 'paused', pausedUntil: '2026-08-01' }, TODAY)).toBe('resuming_today');
    expect(subscriptionState({ status: 'paused' }, TODAY)).toBe('paused');
  });
  it('distinguishes a subscription that has not started yet from one that is running', () => {
    expect(subscriptionState({ status: 'active', startsOn: '2026-09-01' }, TODAY)).toBe('starting');
    expect(subscriptionState({ status: 'active', startsOn: TODAY }, TODAY)).toBe('active');
    expect(subscriptionState({ status: 'active' }, TODAY)).toBe('active');
  });
  it('cancelled always reads cancelled, whatever else the row carries', () => {
    expect(subscriptionState({ status: 'cancelled', pausedUntil: '2027-01-01', startsOn: '2026-09-01' }, TODAY)).toBe('cancelled');
  });
});

describe('billing is what ARRIVED, never what was planned', () => {
  it('counts only delivered drops (mirrors the server’s isBillable)', () => {
    const rows = [{ status: 'delivered' }, { status: 'skipped' }, { status: 'failed' }, { status: 'scheduled' }, { status: 'delivered' }];
    expect(billableCount(rows)).toBe(2);
    expect(billableCount([])).toBe(0);
  });
});

describe('licence expiry — arithmetic on a real date, never a guess', () => {
  it('uses the API’s own 90-day window', () => {
    expect(EXPIRY_WINDOW_DAYS).toBe(90);
  });
  it('calls an already-lapsed document EXPIRED, with how long ago', () => {
    expect(expiryState('2026-07-25', TODAY)).toEqual({ state: 'expired', days: -12 });
  });
  it('flags the next 30 days as expiring, and beyond that as valid', () => {
    expect(expiryState(TODAY, TODAY)).toEqual({ state: 'soon', days: 0 });        // lapses today — still act now
    expect(expiryState('2026-09-05', TODAY)).toEqual({ state: 'soon', days: 30 });
    expect(expiryState('2026-09-06', TODAY)).toEqual({ state: 'later', days: 31 });
  });
  it('reports a missing or unreadable date as UNKNOWN, never as "plenty of time"', () => {
    expect(expiryState(null, TODAY)).toEqual({ state: 'unknown', days: 0 });
    expect(expiryState('', TODAY)).toEqual({ state: 'unknown', days: 0 });
    expect(expiryState('25-07-2026', TODAY)).toEqual({ state: 'unknown', days: 0 });
    expect(daysUntil(TODAY, '2026-08-16')).toBe(10);
  });
  it('sorts soonest-lapsing first and pushes undated documents LAST', () => {
    const rows = [
      { id: 'a', validUntil: '2026-12-01' },
      { id: 'b', validUntil: null },
      { id: 'c', validUntil: '2026-08-10' },
      { id: 'd', validUntil: 'not a date' },
    ];
    expect(sortByExpiry(rows).map((r) => r.id)).toEqual(['c', 'a', 'b', 'd']);
  });
  it('counts what a shopkeeper must act on today (lapsed or lapsing this month)', () => {
    const rows = [{ validUntil: '2026-07-01' }, { validUntil: '2026-08-20' }, { validUntil: '2027-01-01' }, { validUntil: null }];
    expect(actionableCount(rows, TODAY)).toBe(2);
  });
});
