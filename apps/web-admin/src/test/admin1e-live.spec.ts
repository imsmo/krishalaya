// apps/web-admin/src/test/admin1e-live.spec.ts · PC-56 ADMIN-1e console gates.
// A live screen that has silently stopped updating is worse than one that says it is offline, and a schedule that shows
// a success tick for an email nobody sent is worse than one that says delivery is not wired.
import {
  STALE_AFTER_HEARTBEATS, streamState, FEED_WINDOW, mergeFeed, feedCursor, sessionTotals,
  CADENCES, isCadence, MAX_RECIPIENTS, buildSchedule, describeSchedule, wasDelivered, scheduleHealth,
} from '../features/billing/live';

const REPORTS = ['tenants', 'plans', 'invoices', 'gstr', 'revenue'];

describe('live stream state — "stale" is the state that matters', () => {
  const pollMs = 2000;

  it('is connecting until a first frame arrives', () => {
    expect(streamState({ open: false, closed: false, lastFrameAt: null, now: 1000, pollMs })).toBe('connecting');
    expect(streamState({ open: true, closed: false, lastFrameAt: null, now: 1000, pollMs })).toBe('connecting');
  });

  it('goes STALE after missed heartbeats, whatever the browser thinks of its own connection', () => {
    // the server heartbeats every poll, so a gap IS a fault — an EventSource that believes it is open proves nothing
    const now = 100_000;
    expect(streamState({ open: true, closed: false, lastFrameAt: now - pollMs, now, pollMs })).toBe('live');
    expect(streamState({ open: true, closed: false, lastFrameAt: now - pollMs * STALE_AFTER_HEARTBEATS, now, pollMs })).toBe('live');
    expect(streamState({ open: true, closed: false, lastFrameAt: now - pollMs * STALE_AFTER_HEARTBEATS - 1, now, pollMs })).toBe('stale');
  });

  it('reports closed above everything else', () => {
    expect(streamState({ open: true, closed: true, lastFrameAt: 1, now: 2, pollMs })).toBe('closed');
  });

  it('merges newest-first, de-duplicates a replayed frame, and caps the window', () => {
    const e = (id: string, at: string) => ({ id, at, kind: 'payment', amountMinor: '100', currency: 'INR' });
    const first = mergeFeed([], [e('a', '2026-08-06T10:00:00Z'), e('b', '2026-08-06T10:00:01Z')]);
    expect(first.map((x) => x.id)).toEqual(['b', 'a']);                     // newest first
    // a reconnect can legitimately re-deliver the frame the client was mid-render on
    const dedup = mergeFeed(first, [e('b', '2026-08-06T10:00:01Z'), e('c', '2026-08-06T10:00:02Z')]);
    expect(dedup.map((x) => x.id)).toEqual(['c', 'b', 'a']);
    const many = Array.from({ length: FEED_WINDOW + 20 }, (_, i) => e(`x${i}`, `2026-08-06T11:00:${String(i % 60).padStart(2, '0')}Z`));
    expect(mergeFeed([], many)).toHaveLength(FEED_WINDOW);
  });

  it('reconnects from the NEWEST rendered event, not the oldest', () => {
    // cursoring from the oldest would replay everything the operator has already seen
    const feed = [{ id: 'c', at: '2026-08-06T10:00:02Z' }, { id: 'b', at: '2026-08-06T10:00:01Z' }];
    expect(feedCursor(feed)).toEqual({ at: '2026-08-06T10:00:02Z', id: 'c' });
    expect(feedCursor([])).toBeNull();
    expect(feedCursor([{ id: 'x' }])).toBeNull();          // no timestamp = not a usable cursor
  });

  it('counts only PAYMENTS in the session total, per currency', () => {
    const feed = [
      { id: '1', kind: 'payment', amountMinor: '100000', currency: 'INR' },
      { id: '2', kind: 'invoice_issued', amountMinor: '999999', currency: 'INR' },   // issuing is not receiving
      { id: '3', kind: 'payment', amountMinor: '50000', currency: 'INR' },
      { id: '4', kind: 'payment', amountMinor: 'lots', currency: 'INR' },            // unreadable is skipped
    ];
    expect(sessionTotals(feed)).toEqual([{ currency: 'INR', receivedMinor: '150000', count: 2 }]);
    expect(sessionTotals([])).toEqual([]);
  });
});

describe('schedules — the form knows which address is wrong', () => {
  const base = { report: 'revenue', cadence: 'weekly', hourIst: '7', weekdayIso: '1', recipients: 'finance@k.co, ops@k.co' };

  it('mirrors the server vocabulary', () => {
    expect([...CADENCES]).toEqual(['daily', 'weekly', 'monthly']);
    expect(isCadence('hourly')).toBe(false);
  });

  it('splits a pasted distribution list, de-duplicates and lower-cases it', () => {
    const r = buildSchedule({ ...base, recipients: 'Finance@K.co\nops@k.co; finance@k.co' }, REPORTS);
    expect(r.ok && r.value.recipients).toEqual(['finance@k.co', 'ops@k.co']);
  });

  it('requires a weekday for weekly and ignores it otherwise', () => {
    expect(buildSchedule({ ...base, weekdayIso: '' }, REPORTS)).toEqual({ ok: false, error: 'weekday' });
    expect(buildSchedule({ ...base, weekdayIso: '8' }, REPORTS)).toEqual({ ok: false, error: 'weekday' });
    const daily = buildSchedule({ ...base, cadence: 'daily', weekdayIso: '3' }, REPORTS);
    expect(daily.ok && 'weekdayIso' in daily.value).toBe(false);   // not sent — the server refuses a stray weekday
  });

  it('validates the hour, the report and the recipient list', () => {
    expect(buildSchedule({ ...base, hourIst: '24' }, REPORTS)).toEqual({ ok: false, error: 'hour' });
    expect(buildSchedule({ ...base, hourIst: 'seven' }, REPORTS)).toEqual({ ok: false, error: 'hour' });
    expect(buildSchedule({ ...base, report: 'everything' }, REPORTS)).toEqual({ ok: false, error: 'report' });
    expect(buildSchedule({ ...base, cadence: 'hourly' }, REPORTS)).toEqual({ ok: false, error: 'cadence' });
    expect(buildSchedule({ ...base, recipients: '   ' }, REPORTS)).toEqual({ ok: false, error: 'recipients' });
    expect(buildSchedule({ ...base, recipients: 'finance@k.co, nope' }, REPORTS)).toEqual({ ok: false, error: 'email' });
    const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `a${i}@k.co`).join(',');
    expect(buildSchedule({ ...base, recipients: many }, REPORTS)).toEqual({ ok: false, error: 'tooMany' });
    // a plus-tag is a real address
    expect(buildSchedule({ ...base, recipients: 'finance+billing@k.co' }, REPORTS).ok).toBe(true);
  });

  it('describes the rule identically to the server', () => {
    expect(describeSchedule('daily', 7, null)).toBe('every day at 07:00 IST');
    expect(describeSchedule('weekly', 18, 1)).toBe('every Monday at 18:00 IST');
    expect(describeSchedule('weekly', 7, 7)).toBe('every Sunday at 07:00 IST');
    expect(describeSchedule('monthly', 9, null)).toBe('on the 1st of each month at 09:00 IST');
  });

  it('NEVER shows a computed-but-undelivered run as delivered', () => {
    expect(wasDelivered('sent')).toBe(true);
    for (const s of ['provider_pending', 'computed', 'failed', null]) expect(wasDelivered(s)).toBe(false);
  });

  it('names the health of a schedule, including today’s truth for all of them', () => {
    expect(scheduleHealth(false, [])).toBe('paused');
    expect(scheduleHealth(true, [])).toBe('never_run');
    expect(scheduleHealth(true, [{ status: 'failed' }])).toBe('failing');
    expect(scheduleHealth(true, [{ status: 'sent' }])).toBe('delivering');
    // the state every schedule is in until an email provider is wired — and it has its own name for that reason
    expect(scheduleHealth(true, [{ status: 'provider_pending' }])).toBe('computed_not_delivered');
  });
});
