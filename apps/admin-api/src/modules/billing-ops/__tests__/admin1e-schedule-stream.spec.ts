// apps/admin-api/src/modules/billing-ops/__tests__/admin1e-schedule-stream.spec.ts · PC-56 ADMIN-1e.
// A schedule that fires at the wrong moment emails the wrong people, and a stream that loses an event makes an
// operator trust a screen that has stopped telling the truth. Both are timing bugs, and timing bugs need tests.
import {
  CADENCES, isCadence, IST_OFFSET_MIN, MAX_RECIPIENTS, assertRecipients, assertCadenceShape, assertHour,
  nextRunAt, describeSchedule, RUN_STATUSES, wasDelivered,
} from '../domain/scheduled-report';
import { InvalidScheduledReportError } from '../domain/billing-ops.errors';
import { STREAM_POLL_MS, STREAM_BATCH, STREAM_MAX_FRAMES } from '../services/money-stream.service';

describe('scheduled reports — the first run is never "now"', () => {
  it('mirrors the 0095 vocabulary', () => {
    expect([...CADENCES]).toEqual(['daily', 'weekly', 'monthly']);
    expect(isCadence('hourly')).toBe(false);
    expect([...RUN_STATUSES]).toEqual(['computed', 'sent', 'provider_pending', 'failed']);
    expect(IST_OFFSET_MIN).toBe(330);
  });

  // 2026-08-06 is a THURSDAY. 09:00 IST = 03:30 UTC.
  const thu0900Ist = new Date('2026-08-06T03:30:00.000Z');

  it('schedules DAILY for tomorrow when today’s hour has passed', () => {
    // getting this wrong would email everyone the moment a schedule is created or edited
    const next = nextRunAt('daily', 7, null, thu0900Ist);
    expect(next.toISOString()).toBe('2026-08-07T01:30:00.000Z');   // 07:00 IST on the 7th
  });

  it('schedules DAILY for later today when the hour is still ahead', () => {
    expect(nextRunAt('daily', 18, null, thu0900Ist).toISOString()).toBe('2026-08-06T12:30:00.000Z');
  });

  it('schedules WEEKLY on the next matching ISO weekday', () => {
    // Monday (1) from a Thursday → the 10th
    expect(nextRunAt('weekly', 7, 1, thu0900Ist).toISOString()).toBe('2026-08-10T01:30:00.000Z');
    // Thursday (4) TODAY but the hour has passed → next Thursday, the 13th
    expect(nextRunAt('weekly', 7, 4, thu0900Ist).toISOString()).toBe('2026-08-13T01:30:00.000Z');
    // Thursday (4) today with the hour ahead → today
    expect(nextRunAt('weekly', 18, 4, thu0900Ist).toISOString()).toBe('2026-08-06T12:30:00.000Z');
    // Sunday is ISO 7, not 0 — the classic off-by-one that sends a Sunday digest on Monday
    expect(nextRunAt('weekly', 7, 7, thu0900Ist).toISOString()).toBe('2026-08-09T01:30:00.000Z');
  });

  // 2026-08-09 is a SUNDAY. 06:00 IST = 00:30 UTC.
  const sun0600Ist = new Date('2026-08-09T00:30:00.000Z');

  it('handles a weekly schedule computed FROM a Sunday (the ISO 0-vs-7 trap)', () => {
    // MUTATION TESTING FOUND THIS GAP: the earlier cases all computed from a Thursday, where treating Sunday as 0
    // instead of 7 happens to give the same answer. The divergence only appears when TODAY is Sunday — and then a
    // "every Sunday" schedule would be pushed a whole week out.
    expect(nextRunAt('weekly', 7, 7, sun0600Ist).toISOString()).toBe('2026-08-09T01:30:00.000Z');   // today, 07:00 IST
    // ...and once Sunday's hour has passed, the next one is a week later, not tomorrow
    const sun0800Ist = new Date('2026-08-09T02:30:00.000Z');
    expect(nextRunAt('weekly', 7, 7, sun0800Ist).toISOString()).toBe('2026-08-16T01:30:00.000Z');
    // a Monday schedule from a Sunday is tomorrow
    expect(nextRunAt('weekly', 7, 1, sun0600Ist).toISOString()).toBe('2026-08-10T01:30:00.000Z');
    // a Saturday schedule from a Sunday is six days away (not yesterday)
    expect(nextRunAt('weekly', 7, 6, sun0600Ist).toISOString()).toBe('2026-08-15T01:30:00.000Z');
  });

  it('schedules MONTHLY on the 1st, skipping to next month when this one has gone', () => {
    expect(nextRunAt('monthly', 7, null, thu0900Ist).toISOString()).toBe('2026-09-01T01:30:00.000Z');
    // early in the month with the hour ahead → this month's 1st
    const firstAt0600Ist = new Date('2026-08-01T00:30:00.000Z');
    expect(nextRunAt('monthly', 7, null, firstAt0600Ist).toISOString()).toBe('2026-08-01T01:30:00.000Z');
  });

  it('crosses a month and a year boundary correctly', () => {
    const dec31 = new Date('2026-12-31T20:00:00.000Z');   // 2027-01-01 01:30 IST
    expect(nextRunAt('daily', 7, null, dec31).toISOString()).toBe('2027-01-01T01:30:00.000Z');
    expect(nextRunAt('monthly', 7, null, new Date('2026-01-31T20:00:00.000Z')).toISOString()).toBe('2026-02-01T01:30:00.000Z');
  });

  it('requires a weekday for weekly and REFUSES one otherwise', () => {
    expect(assertCadenceShape('weekly', 3)).toBe(3);
    expect(() => assertCadenceShape('weekly', null)).toThrow(InvalidScheduledReportError);
    expect(() => assertCadenceShape('weekly', 8)).toThrow(InvalidScheduledReportError);
    expect(assertCadenceShape('daily', null)).toBeNull();
    // a stale weekday on a monthly schedule is a lie a reader would act on (and the 0095 CHECK refuses it too)
    expect(() => assertCadenceShape('monthly', 2)).toThrow(InvalidScheduledReportError);
  });

  it('validates the hour as a whole hour in range', () => {
    expect(assertHour(0)).toBe(0);
    expect(assertHour(23)).toBe(23);
    for (const bad of [-1, 24, 7.5, Number.NaN]) expect(() => assertHour(bad)).toThrow(InvalidScheduledReportError);
  });

  it('de-duplicates and lower-cases recipients, and refuses nonsense', () => {
    expect(assertRecipients([' Finance@Krishalaya.CO ', 'finance@krishalaya.co', 'ops@krishalaya.co']))
      .toEqual(['finance@krishalaya.co', 'ops@krishalaya.co']);
    expect(() => assertRecipients([])).toThrow(InvalidScheduledReportError);
    expect(() => assertRecipients(['   '])).toThrow(InvalidScheduledReportError);
    expect(() => assertRecipients(['not-an-email'])).toThrow(InvalidScheduledReportError);
    const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `a${i}@k.co`);
    expect(() => assertRecipients(many)).toThrow(InvalidScheduledReportError);
    // a plus-tag is a valid address and must not be rejected by an over-clever regex
    expect(assertRecipients(['finance+billing@krishalaya.co'])).toEqual(['finance+billing@krishalaya.co']);
  });

  it('describes the rule as a sentence, for the console and the audit row', () => {
    expect(describeSchedule('daily', 7, null)).toBe('every day at 07:00 IST');
    expect(describeSchedule('weekly', 18, 1)).toBe('every Monday at 18:00 IST');
    expect(describeSchedule('weekly', 7, 7)).toBe('every Sunday at 07:00 IST');
    expect(describeSchedule('monthly', 9, null)).toBe('on the 1st of each month at 09:00 IST');
  });

  it('NEVER calls a computed-but-undelivered run a delivery', () => {
    // this platform has no email provider; showing a sent tick would have someone waiting for an email that is not coming
    expect(wasDelivered('sent')).toBe(true);
    expect(wasDelivered('provider_pending')).toBe(false);
    expect(wasDelivered('computed')).toBe(false);
    expect(wasDelivered('failed')).toBe(false);
    expect(wasDelivered(null)).toBe(false);
  });
});

describe('the live money stream — bounded latency, never lost events', () => {
  it('states its own latency bound and batch size', () => {
    expect(STREAM_POLL_MS).toBe(2000);
    expect(STREAM_BATCH).toBe(50);
  });

  it('caps a connection at one hour of frames, so a forgotten tab is not a leak', () => {
    // the client reconnects with its cursor, so bounding the connection costs no events
    expect(STREAM_MAX_FRAMES * STREAM_POLL_MS).toBe(60 * 60 * 1000);
  });
});
