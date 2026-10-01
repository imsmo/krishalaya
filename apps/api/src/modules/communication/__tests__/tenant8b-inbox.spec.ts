// modules/communication/__tests__/tenant8b-inbox.spec.ts · PC-56 TENANT-8b · THE INBOX — the pure logic, pinned.
//
// Every rule the inbox wave added lives in a pure function (Law 5's spirit: one place), and each is pinned here:
// the quiet window's arithmetic across midnight and zones (F-5's default, F-4's `held_until`), the zone sanitiser (F-6:
// a typo can never throw inside a fan-out), what the fan-out writes for every channel it did NOT send (F-4), the release
// decision, the ladder (W434), the delivery instance and its grouping, the failure vocabulary (F-10, Law 6), the health
// tiles, the form chain's three reviews, and the state machine's two new edges.
import { isUsableTimezone, sanitiseTimezone, LAST_RESORT_ZONE } from '../domain/timezone';
import {
  crossesMidnight, effectiveWindow, fromMinutes, isWithinWindow, localParts, nextOccurrence, parseWindowSetting, toMinutes, wallToInstant, windowEndAfter, windowLengthMinutes, zoneOffsetMinutes,
} from '../domain/quiet-window';
import {
  byChannelOrder, fallbackAction, fanoutKeyOf, groupByFanout, healthFigures, ladderFor, ladderOutcome, moduleOf, normaliseFailureReason, releaseDecision, suppressionRows, FAILURE_REASONS, SUPPRESSED_REASONS,
} from '../domain/delivery-log';
import { reviewLanguage, reviewPreferences, reviewWindow, inForce, normaliseTime } from '../domain/inbox-review';
import { canTransition, statusesThatCanBecome } from '../domain/notification.state';
import { resolveChannels } from '../domain/channel-resolution';
import { Notification } from '../domain/notification.entity';
import { NotificationService } from '../services/notification.service';
import { InboxService, decodeInboxCursor, encodeInboxCursor } from '../services/inbox.service';
import { NotificationEvent } from '../domain/notification-event.entity';
import { NotificationTemplate } from '../domain/notification-template.entity';
import { NotifChannel } from '../domain/communication.events';

const IST = 'Asia/Kolkata';
const W = (starts: string, ends: string, timezone = IST) => ({ starts, ends, timezone });
const eff = (starts: string, ends: string, timezone = IST, source: 'own' | 'tenant_default' = 'own') => ({ starts, ends, timezone, source, sanitised: false, requestedZone: null });
const at = (iso: string) => new Date(iso);

describe('timezone · F-6 — a bad zone can never throw', () => {
  it('knows usable zones and refuses the rest without throwing', () => {
    expect(isUsableTimezone(IST)).toBe(true);
    expect(isUsableTimezone('Europe/London')).toBe(true);
    expect(isUsableTimezone('Asia/Kolkatta')).toBe(false);
    expect(isUsableTimezone('')).toBe(false);
    expect(isUsableTimezone('   ')).toBe(false);
    expect(isUsableTimezone(null)).toBe(false);
    expect(isUsableTimezone(42)).toBe(false);
    expect(isUsableTimezone('A'.repeat(65))).toBe(false);
    expect(isUsableTimezone(' Asia/Kolkata ')).toBe(true);           // trimmed before asking
  });
  it('sanitises to the cooperative zone, then to UTC — and says when it substituted', () => {
    expect(sanitiseTimezone('Asia/Kolkatta', IST)).toEqual({ zone: IST, sanitised: true, requested: 'Asia/Kolkatta' });
    expect(sanitiseTimezone('Europe/London', IST)).toEqual({ zone: 'Europe/London', sanitised: false, requested: 'Europe/London' });
    expect(sanitiseTimezone(null, IST)).toEqual({ zone: IST, sanitised: false, requested: null });   // asking for nothing is not a substitution
    expect(sanitiseTimezone('  ', IST)).toEqual({ zone: IST, sanitised: false, requested: null });
    expect(sanitiseTimezone('Nope/Nope', 'Also/Bad')).toEqual({ zone: LAST_RESORT_ZONE, sanitised: true, requested: 'Nope/Nope' });
    expect(sanitiseTimezone('Nope/Nope', null).zone).toBe('UTC');
    expect(sanitiseTimezone(' Asia/Kolkata ', null).zone).toBe(IST);
  });
});

describe('quiet window · the arithmetic', () => {
  it('parses times, formats minutes, measures length and midnight', () => {
    expect(toMinutes('21:00')).toBe(1260); expect(toMinutes('06:00:59')).toBe(360); expect(toMinutes('00:00')).toBe(0); expect(toMinutes('23:59')).toBe(1439);
    for (const bad of ['24:00', '7:00', '21:60', '', null, undefined, 'x']) expect(toMinutes(bad as any)).toBeNull();
    expect(fromMinutes(450)).toBe('07:30'); expect(fromMinutes(-60)).toBe('23:00'); expect(fromMinutes(1440)).toBe('00:00'); expect(fromMinutes(5)).toBe('00:05');
    expect(windowLengthMinutes('21:00', '06:00')).toBe(540);
    expect(windowLengthMinutes('22:00', '05:30')).toBe(450);
    expect(windowLengthMinutes('09:00', '17:00')).toBe(480);
    expect(windowLengthMinutes('06:00', '06:00')).toBe(0);
    expect(windowLengthMinutes('bad', '06:00')).toBe(0);
    expect(crossesMidnight('21:00', '06:00')).toBe(true);
    expect(crossesMidnight('09:00', '17:00')).toBe(false);
    expect(crossesMidnight('06:00', '06:00')).toBe(false);
    expect(crossesMidnight('bad', '06:00')).toBe(false);
  });
  it('is inside an overnight window from the start (inclusive) to the end (exclusive), read in ITS zone', () => {
    const w = W('21:00', '06:00');
    expect(isWithinWindow(at('2026-09-30T15:29:00Z'), w)).toBe(false);   // 20:59 IST
    expect(isWithinWindow(at('2026-09-30T15:30:00Z'), w)).toBe(true);    // 21:00 IST
    expect(isWithinWindow(at('2026-09-30T18:30:00Z'), w)).toBe(true);    // 00:00 IST
    expect(isWithinWindow(at('2026-10-01T00:29:00Z'), w)).toBe(true);    // 05:59 IST
    expect(isWithinWindow(at('2026-10-01T00:30:00Z'), w)).toBe(false);   // 06:00 IST
    expect(isWithinWindow(at('2026-09-30T06:30:00Z'), w)).toBe(false);   // 12:00 IST
    // the same instant, a different zone: 22:00 IST is 17:30 in London — outside London's 21:00–06:00
    expect(isWithinWindow(at('2026-09-30T16:30:00Z'), W('21:00', '06:00', 'Europe/London'))).toBe(false);
    expect(isWithinWindow(at('2026-09-30T16:30:00Z'), w)).toBe(true);
  });
  it('a same-day window and an OFF window', () => {
    const d = W('09:00', '17:00');
    expect(isWithinWindow(at('2026-09-30T03:30:00Z'), d)).toBe(true);    // 09:00 IST
    expect(isWithinWindow(at('2026-09-30T11:29:00Z'), d)).toBe(true);    // 16:59 IST
    expect(isWithinWindow(at('2026-09-30T11:30:00Z'), d)).toBe(false);   // 17:00 IST
    expect(isWithinWindow(at('2026-09-30T03:29:00Z'), d)).toBe(false);
    expect(isWithinWindow(at('2026-09-30T16:30:00Z'), W('06:00', '06:00'))).toBe(false);
    expect(isWithinWindow(at('2026-09-30T16:30:00Z'), W('bad', '06:00'))).toBe(false);
  });
  it('the END of the window a held row waits for — tonight\'s window ends tomorrow morning; after midnight, this morning', () => {
    const w = W('21:00', '06:00');
    expect(windowEndAfter(at('2026-09-30T16:30:00Z'), w)!.toISOString()).toBe('2026-10-01T00:30:00.000Z');   // 22:00 → 06:00 next day
    expect(windowEndAfter(at('2026-09-30T21:30:00Z'), w)!.toISOString()).toBe('2026-10-01T00:30:00.000Z');   // 03:00 → 06:00 same morning
    expect(windowEndAfter(at('2026-10-01T00:29:59Z'), w)!.toISOString()).toBe('2026-10-01T00:30:00.000Z');
    expect(windowEndAfter(at('2026-09-30T06:30:00Z'), w)).toBeNull();                                         // not inside
    expect(windowEndAfter(at('2026-09-30T04:00:00Z'), W('09:00', '17:00'))!.toISOString()).toBe('2026-09-30T11:30:00.000Z');
    // London, across the end of BST (25 Oct 2026, clocks go back at 02:00): 23:00 BST on the 24th → 06:00 GMT on the 25th
    expect(windowEndAfter(at('2026-10-24T22:00:00Z'), W('21:00', '06:00', 'Europe/London'))!.toISOString()).toBe('2026-10-25T06:00:00.000Z');
    // New York's spring-forward (8 Mar 2026): 22:00 EST → 06:00 EDT (10:00Z)
    expect(windowEndAfter(at('2026-03-08T03:00:00Z'), W('21:00', '06:00', 'America/New_York'))!.toISOString()).toBe('2026-03-08T10:00:00.000Z');
  });
  it('the next occurrence for the review — current, later today, tomorrow', () => {
    const w = W('22:00', '05:30');
    expect(nextOccurrence(at('2026-09-30T06:30:00Z'), w)).toEqual({ start: at('2026-09-30T16:30:00Z'), end: at('2026-10-01T00:00:00Z'), current: false });   // noon
    expect(nextOccurrence(at('2026-09-30T21:30:00Z'), w)).toEqual({ start: at('2026-09-30T16:30:00Z'), end: at('2026-10-01T00:00:00Z'), current: true });    // 03:00, began yesterday
    expect(nextOccurrence(at('2026-09-30T17:00:00Z'), w)).toEqual({ start: at('2026-09-30T16:30:00Z'), end: at('2026-10-01T00:00:00Z'), current: true });    // 22:30
    const day = W('09:00', '17:00');
    expect(nextOccurrence(at('2026-09-30T12:00:00Z'), day)).toEqual({ start: at('2026-10-01T03:30:00Z'), end: at('2026-10-01T11:30:00Z'), current: false });  // 17:30 → tomorrow
    expect(nextOccurrence(at('2026-09-30T01:00:00Z'), day)).toEqual({ start: at('2026-09-30T03:30:00Z'), end: at('2026-09-30T11:30:00Z'), current: false });  // 06:30 → today
    expect(nextOccurrence(at('2026-09-30T01:00:00Z'), W('06:00', '06:00'))).toBeNull();
    expect(nextOccurrence(at('2026-09-30T01:00:00Z'), W('bad', '06:00'))).toBeNull();
  });
  it('offsets and wall-clock → instant', () => {
    expect(zoneOffsetMinutes(at('2026-09-30T12:00:00Z'), IST)).toBe(330);
    expect(zoneOffsetMinutes(at('2026-07-01T12:00:00Z'), 'Europe/London')).toBe(60);
    expect(zoneOffsetMinutes(at('2026-12-01T12:00:00Z'), 'Europe/London')).toBe(0);
    expect(zoneOffsetMinutes(at('2026-07-01T12:00:00Z'), 'America/New_York')).toBe(-240);
    expect(wallToInstant(2026, 10, 1, 360, IST).toISOString()).toBe('2026-10-01T00:30:00.000Z');
    expect(wallToInstant(2026, 1, 15, 21 * 60, 'America/New_York').toISOString()).toBe('2026-01-16T02:00:00.000Z');
    expect(localParts(at('2026-09-30T18:45:00Z'), IST)).toEqual({ y: 2026, m: 10, d: 1, minutes: 15 });
  });
  it('WHICH window applies (F-5): yours (zone sanitised, F-6), else the cooperative\'s default in its zone, else none', () => {
    expect(effectiveWindow(W('22:00', '07:00', 'Europe/London'), { starts: '21:00', ends: '06:00' }, IST)).toEqual({ starts: '22:00', ends: '07:00', timezone: 'Europe/London', source: 'own', sanitised: false, requestedZone: 'Europe/London' });
    expect(effectiveWindow(W('22:00', '07:00', 'Asia/Kolkatta'), { starts: '21:00', ends: '06:00' }, IST)).toEqual({ starts: '22:00', ends: '07:00', timezone: IST, source: 'own', sanitised: true, requestedZone: 'Asia/Kolkatta' });
    expect(effectiveWindow(null, { starts: '21:00', ends: '06:00' }, IST)).toEqual({ starts: '21:00', ends: '06:00', timezone: IST, source: 'tenant_default', sanitised: false, requestedZone: null });
    expect(effectiveWindow(null, { starts: '21:00', ends: '06:00' }, null)!.timezone).toBe('UTC');
    expect(effectiveWindow(W('bad', '07:00'), { starts: '21:00', ends: '06:00' }, IST)!.source).toBe('tenant_default');   // a malformed own row is not a window
    expect(effectiveWindow(W('22:00', 'bad'), null, IST)).toBeNull();
    expect(effectiveWindow(null, null, IST)).toBeNull();                       // a platform notice has no cooperative to inherit from
    expect(effectiveWindow(null, { starts: 'x', ends: '06:00' }, IST)).toBeNull();
  });
  it('reads the tenant setting only when it IS a window', () => {
    expect(parseWindowSetting({ starts: '21:00', ends: '06:00' })).toEqual({ starts: '21:00', ends: '06:00' });
    expect(parseWindowSetting({ starts: '21:00' })).toBeNull();
    expect(parseWindowSetting({ starts: 21, ends: '06:00' })).toBeNull();
    expect(parseWindowSetting({ starts: '25:00', ends: '06:00' })).toBeNull();
    expect(parseWindowSetting('21:00-06:00')).toBeNull();
    expect(parseWindowSetting(null)).toBeNull();
  });
});

describe('delivery log · F-4 — every channel NOT sent is a row with its reason', () => {
  const night = at('2026-09-30T16:30:00Z');
  it('quiet hours HOLD until the window ends; opt-outs are final; the routine collapse is recorded, the used fallback is not', () => {
    const rows = suppressionRows({
      resolved: { channels: ['push', 'sms', 'inapp'], suppressed: [{ channel: 'whatsapp', reason: 'quiet_hours' }, { channel: 'email', reason: 'opted_out' }] },
      sentNow: ['inapp', 'push'], fallbackUsed: null, window: eff('21:00', '06:00'), now: night,
    });
    expect(rows).toEqual([
      { channel: 'whatsapp', reason: 'quiet_hours', heldUntil: at('2026-10-01T00:30:00Z') },
      { channel: 'email', reason: 'opted_out', heldUntil: null },
      { channel: 'sms', reason: 'routine_collapsed', heldUntil: null },
    ]);
    expect(suppressionRows({ resolved: { channels: ['push', 'sms'], suppressed: [] }, sentNow: ['push'], fallbackUsed: 'sms', window: null, now: night })).toEqual([]);
    // a hold with no computable end is held until NOW — the next tick re-asks it; a hold always ends
    expect(suppressionRows({ resolved: { channels: [], suppressed: [{ channel: 'push', reason: 'quiet_hours' }] }, sentNow: [], fallbackUsed: null, window: null, now: night })).toEqual([{ channel: 'push', reason: 'quiet_hours', heldUntil: night }]);
  });
  it('the routine SMS fallback obeys quiet hours and never makes a second SMS row', () => {
    const none = { suppressed: [] as Array<{ channel: NotifChannel }> };
    expect(fallbackAction({ fallback: 'sms', priority: 'informational', inQuiet: false, resolved: none })).toBe('send');
    expect(fallbackAction({ fallback: 'sms', priority: 'informational', inQuiet: true, resolved: none })).toBe('hold');
    expect(fallbackAction({ fallback: 'sms', priority: 'critical', inQuiet: true, resolved: none })).toBe('send');
    expect(fallbackAction({ fallback: 'sms', priority: 'informational', inQuiet: true, resolved: { suppressed: [{ channel: 'sms' }] } })).toBe('skip');
    expect(fallbackAction({ fallback: 'sms', priority: 'informational', inQuiet: false, resolved: { suppressed: [{ channel: 'sms' }] } })).toBe('skip');
    expect(fallbackAction({ fallback: 'email', priority: 'informational', inQuiet: true, resolved: none })).toBe('send');   // email is never held
  });
  it('the vocabularies match 0176\'s CHECK and lookup rows', () => {
    expect([...SUPPRESSED_REASONS]).toEqual(['quiet_hours', 'channel_off', 'routine_collapsed', 'opted_out']);
    expect(FAILURE_REASONS).toHaveLength(15);
    expect(FAILURE_REASONS).toContain('unrecorded');
  });
  it('a failure reason is a CODE, never the provider\'s words (Law 6)', () => {
    expect(normaliseFailureReason('no_template')).toBe('no_template');
    expect(normaliseFailureReason(' DND_REGISTERED ')).toBe('dnd_registered');
    expect(normaliseFailureReason('gateway said no')).toBe('provider_rejected');
    expect(normaliseFailureReason('unrecorded')).toBe('provider_rejected');      // the legacy marker is the migration's, never a writer's
    expect(normaliseFailureReason(null)).toBe('dispatch_failed');
    expect(normaliseFailureReason('', 'provider_rejected')).toBe('provider_rejected');
    expect(normaliseFailureReason(undefined, 'provider_rejected')).toBe('provider_rejected');
  });
});

describe('the release · re-asked in the morning', () => {
  const morning = at('2026-10-01T00:31:00Z');
  const base = { priority: 'important' as const, userCanOptOut: true, channel: 'push' as NotifChannel, prefEnabled: undefined as boolean | undefined, window: eff('21:00', '06:00'), now: morning };
  it('sends when the window has ended', () => { expect(releaseDecision(base)).toEqual({ kind: 'send' }); });
  it('never sends what the member switched off overnight — unless the event is locked', () => {
    expect(releaseDecision({ ...base, prefEnabled: false })).toEqual({ kind: 'opted_out' });
    expect(releaseDecision({ ...base, prefEnabled: false, userCanOptOut: false })).toEqual({ kind: 'send' });
    expect(releaseDecision({ ...base, prefEnabled: true })).toEqual({ kind: 'send' });
  });
  it('holds again when the member widened the window', () => {
    expect(releaseDecision({ ...base, window: eff('21:00', '07:00') })).toEqual({ kind: 'rehold', until: at('2026-10-01T01:30:00Z') });
    expect(releaseDecision({ ...base, window: eff('21:00', '07:00'), priority: 'critical' })).toEqual({ kind: 'send' });
    expect(releaseDecision({ ...base, window: eff('21:00', '07:00'), channel: 'email' })).toEqual({ kind: 'send' });
    expect(releaseDecision({ ...base, window: null })).toEqual({ kind: 'send' });
  });
});

describe('W434 · the ladder, from the row\'s own columns', () => {
  const t0 = at('2026-09-30T16:30:00Z'); const t1 = at('2026-10-01T00:31:00Z'); const t2 = at('2026-10-01T00:31:05Z');
  const row = (o: Partial<Parameters<typeof ladderFor>[0]>) => ({ id: 'n', channel: 'push', status: 'sent', suppressedReason: null, failureReason: null, createdAt: t0, sentAt: null, deliveredAt: null, failedAt: null, readAt: null, heldUntil: null, releasedAt: null, ...o });
  it('queued → sent → delivered → read, times from the columns', () => {
    expect(ladderFor(row({ sentAt: t0, status: 'delivered', deliveredAt: t1 }))).toEqual([{ kind: 'queued', at: t0, reason: null }, { kind: 'sent', at: t0, reason: null }, { kind: 'delivered', at: t1, reason: null }]);
    expect(ladderFor(row({ channel: 'inapp', sentAt: t0, status: 'read', readAt: t1 })).map((s) => s.kind)).toEqual(['queued', 'sent', 'read']);
    expect(ladderFor(row({ sentAt: t0, status: 'delivered' }))[2]).toEqual({ kind: 'delivered', at: null, reason: null });   // delivered before 0176 kept the time
    expect(ladderFor(row({ channel: 'inapp', sentAt: t0, status: 'read' }))[2]).toEqual({ kind: 'read', at: null, reason: null });          // a read with no recorded time says so
  });
  it('failed with its reason and time; suppressed with its reason; a hold, released and sent', () => {
    expect(ladderFor(row({ status: 'failed', failedAt: t0, failureReason: 'no_template' })).map((s) => [s.kind, s.reason])).toEqual([['queued', null], ['failed', 'no_template']]);
    expect(ladderFor(row({ status: 'suppressed', suppressedReason: 'opted_out' }))).toEqual([{ kind: 'queued', at: t0, reason: null }, { kind: 'suppressed', at: t0, reason: 'opted_out' }]);
    expect(ladderFor(row({ status: 'suppressed', suppressedReason: 'quiet_hours', heldUntil: t1 }))).toEqual([{ kind: 'queued', at: t0, reason: null }, { kind: 'held', at: t0, reason: 'quiet_hours', until: t1 }]);
    expect(ladderFor(row({ status: 'sent', suppressedReason: 'quiet_hours', heldUntil: t1, releasedAt: t1, sentAt: t2 })).map((s) => s.kind)).toEqual(['queued', 'held', 'released', 'sent']);
    expect(ladderFor(row({ status: 'failed', suppressedReason: 'quiet_hours', heldUntil: t1, releasedAt: t1, failedAt: t2, failureReason: 'no_device' })).map((s) => s.kind)).toEqual(['queued', 'held', 'released', 'failed']);
  });
  it('the outcome is what the row says now', () => {
    expect(ladderOutcome({ status: 'suppressed', suppressedReason: 'quiet_hours', releasedAt: null })).toBe('held');
    expect(ladderOutcome({ status: 'suppressed', suppressedReason: 'opted_out', releasedAt: null })).toBe('suppressed');
    expect(ladderOutcome({ status: 'sent', suppressedReason: 'quiet_hours', releasedAt: t1 })).toBe('sent');
    expect(ladderOutcome({ status: 'suppressed', suppressedReason: 'quiet_hours', releasedAt: t1 })).toBe('suppressed');   // released means no longer HELD
    for (const s of ['queued', 'sent', 'delivered', 'failed', 'read']) expect(ladderOutcome({ status: s, suppressedReason: null, releasedAt: null })).toBe(s);
    expect(ladderOutcome({ status: 'weird', suppressedReason: null, releasedAt: null })).toBe('queued');
  });
  it('channels are drawn in-app first, then the wires; unknown channels last', () => {
    expect(byChannelOrder([{ channel: 'email' }, { channel: 'sms' }, { channel: 'inapp' }, { channel: 'fax' }, { channel: 'push' }]).map((r) => r.channel)).toEqual(['inapp', 'push', 'sms', 'email', 'fax']);
    expect(byChannelOrder([{ channel: 'zz' }, { channel: 'aa' }]).map((r) => r.channel)).toEqual(['aa', 'zz']);
  });
});

describe('the delivery instance', () => {
  it('one key per (event delivery × recipient), shared by every channel, distinct across people and events', () => {
    const k = fanoutKeyOf('evt-1', 'u1');
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(fanoutKeyOf('evt-1', 'u1')).toBe(k);
    expect(fanoutKeyOf('evt-1', 'u2')).not.toBe(k);
    expect(fanoutKeyOf('evt-2', 'u1')).not.toBe(k);
  });
  it('groups by the key; a row with no key (before 0176) stands alone — never merged by time', () => {
    const g = groupByFanout([{ id: 'a', fanoutKey: 'k1' }, { id: 'b', fanoutKey: 'k1' }, { id: 'c', fanoutKey: null }, { id: 'd', fanoutKey: null }, { id: 'e', fanoutKey: 'k2' }]);
    expect([...g.entries()].map(([k, v]) => [k, v.map((x) => x.id)])).toEqual([['k1', ['a', 'b']], ['row:c', ['c']], ['row:d', ['d']], ['k2', ['e']]]);
  });
  it('the module is the catalogue namespace', () => {
    expect(moduleOf('dispute.resolved')).toBe('dispute');
    expect(moduleOf('api_key.revoked')).toBe('api_key');
    expect(moduleOf('broadcast')).toBe('broadcast');
    expect(moduleOf('.weird')).toBe('.weird');
  });
});

describe('W204 · the health tiles are sums of what the log says', () => {
  it('counts external attempts, receipts, failures by reason, suppressions by reason, in-app items, costed sends', () => {
    const f = healthFigures([
      { channel: 'sms', status: 'delivered', suppressedReason: null, failureReason: null, n: 5, withCost: 5 },
      { channel: 'push', status: 'read', suppressedReason: null, failureReason: null, n: 1, withCost: 0 },
      { channel: 'sms', status: 'sent', suppressedReason: null, failureReason: null, n: 2, withCost: 2 },
      { channel: 'sms', status: 'failed', suppressedReason: null, failureReason: 'dnd_registered', n: 3, withCost: 0 },
      { channel: 'push', status: 'failed', suppressedReason: null, failureReason: null, n: 1, withCost: 0 },
      { channel: 'push', status: 'suppressed', suppressedReason: 'quiet_hours', failureReason: null, n: 4, withCost: 0 },
      { channel: 'sms', status: 'suppressed', suppressedReason: null, failureReason: null, n: 1, withCost: 0 },
      { channel: 'inapp', status: 'sent', suppressedReason: null, failureReason: null, n: 7, withCost: 0 },
      { channel: 'inapp', status: 'read', suppressedReason: null, failureReason: null, n: 2, withCost: 0 },
      { channel: 'push', status: 'queued', suppressedReason: null, failureReason: null, n: 9, withCost: 0 },
    ]);
    expect(f).toEqual({ leftPlatform: 12, delivered: 6, awaitingReceipt: 2, failed: 4, suppressed: 5, inapp: 9, costedSends: 7,
      suppressedByReason: { quiet_hours: 4, unknown: 1 }, failedByReason: { dnd_registered: 3, unrecorded: 1 } });
    expect(healthFigures([])).toEqual({ leftPlatform: 0, delivered: 0, awaitingReceipt: 0, failed: 0, suppressed: 0, inapp: 0, costedSends: 0, suppressedByReason: {}, failedByReason: {} });
  });
});

describe('the form chain\'s reviews', () => {
  const noon = at('2026-09-30T06:30:00Z');
  it('Change window: blank zone → the cooperative\'s; the maths; the diff against today\'s window', () => {
    const r = reviewWindow({ entered: { starts: '22:00', ends: '05:30' }, zoneKnown: null, tenantZone: IST, current: eff('21:00', '06:00', IST, 'tenant_default'), now: noon });
    expect(r.ready).toBe(true);
    expect(r.stored).toEqual({ starts: '22:00', ends: '05:30', timezone: IST });
    expect(r.maths).toEqual({ lengthMinutes: 450, off: false, crossesMidnight: true, next: { start: '2026-09-30T16:30:00.000Z', end: '2026-10-01T00:00:00.000Z', current: false }, zone: IST, zoneFromTenant: true });
    expect(r.diff).toEqual([{ field: 'starts', before: '21:00', after: '22:00' }, { field: 'ends', before: '06:00', after: '05:30' }]);
    expect(r.fields.find((f) => f.name === 'timezone')).toEqual({ name: 'timezone', entered: null, stored: IST, normalised: true });
    expect(r.entityType).toBe('quiet_hours');
  });
  it('refuses the typo (the database\'s registry), an unusable zone, bad times — every reason, each on its field', () => {
    const typo = reviewWindow({ entered: { starts: '22:00', ends: '06:00', timezone: 'Asia/Kolkatta' }, zoneKnown: false, tenantZone: IST, current: null, now: noon });
    expect(typo.refusals).toEqual([{ field: 'timezone', code: 'TIMEZONE_UNKNOWN' }]);
    expect(typo.maths.next).toBeNull();
    const unusable = reviewWindow({ entered: { starts: '22:00', ends: '06:00', timezone: 'Nope/Zone' }, zoneKnown: true, tenantZone: IST, current: null, now: noon });
    expect(unusable.refusals).toEqual([{ field: 'timezone', code: 'TIMEZONE_UNUSABLE' }]);
    const bad = reviewWindow({ entered: { starts: '25:00', ends: 'x' }, zoneKnown: null, tenantZone: IST, current: null, now: noon });
    expect(bad.refusals).toEqual([{ field: 'starts', code: 'STARTS_INVALID' }, { field: 'ends', code: 'ENDS_INVALID' }]);
    expect(bad.maths.off).toBe(false);
    const noZone = reviewWindow({ entered: { starts: '22:00', ends: '06:00' }, zoneKnown: null, tenantZone: null, current: null, now: noon });
    expect(noZone.refusals).toEqual([{ field: 'timezone', code: 'TIMEZONE_UNKNOWN' }]);
    expect(reviewWindow({ entered: { starts: '22:00', ends: '06:00' }, zoneKnown: null, tenantZone: IST, current: null, now: noon }).diff).toBeNull();
    // the cooperative's own zone unusable (a corrupt country row): a blank entry is refused, never stored as that zone
    const corrupt = reviewWindow({ entered: { starts: '22:00', ends: '06:00' }, zoneKnown: null, tenantZone: 'Nope/Zone', current: null, now: noon });
    expect([corrupt.refusals, corrupt.stored.timezone]).toEqual([[{ field: 'timezone', code: 'TIMEZONE_UNKNOWN' }], null]);
  });
  it('an OFF window is printed as off, and an unchanged own window is refused by name (not the cooperative default)', () => {
    const off = reviewWindow({ entered: { starts: '06:00', ends: '06:00', timezone: IST }, zoneKnown: true, tenantZone: IST, current: null, now: noon });
    expect(off.ready).toBe(true);
    expect(off.maths).toMatchObject({ lengthMinutes: 0, off: true, next: null });
    const same = reviewWindow({ entered: { starts: '21:00:00', ends: '06:00', timezone: IST }, zoneKnown: true, tenantZone: IST, current: eff('21:00:00', '06:00:00'), now: noon });
    expect(same.refusals).toEqual([{ field: null, code: 'WINDOW_UNCHANGED' }]);
    // the same hours in ANOTHER zone is a change
    expect(reviewWindow({ entered: { starts: '21:00', ends: '06:00', timezone: 'Europe/London' }, zoneKnown: true, tenantZone: IST, current: eff('21:00', '06:00'), now: noon }).ready).toBe(true);
    const asDefault = reviewWindow({ entered: { starts: '21:00', ends: '06:00', timezone: IST }, zoneKnown: true, tenantZone: IST, current: eff('21:00', '06:00', IST, 'tenant_default'), now: noon });
    expect(asDefault.ready).toBe(true);                       // writing your own copy of the default is a change: you now own it
    expect(normaliseTime('06:00:30')).toBe('06:00'); expect(normaliseTime('bad')).toBeNull();
  });
  it('Save preferences: locked, not-sent and unknown refused by name; the diff is against what is in force; duplicates once', () => {
    const catalog = new Map([
      ['auth.otp', { code: 'auth.otp', priority: 'critical', userCanOptOut: false, defaultChannels: ['sms', 'whatsapp'] }],
      ['order.packed', { code: 'order.packed', priority: 'important', userCanOptOut: true, defaultChannels: ['push', 'sms'] }],
    ]);
    const explicit = new Map([['order.packed::push', false]]);
    expect(inForce(explicit, 'order.packed', 'push')).toBe(false);
    expect(inForce(explicit, 'order.packed', 'sms')).toBe(true);
    const r = reviewPreferences({ catalog, explicit, changes: [
      { eventCode: 'auth.otp', channel: 'sms', isEnabled: false },
      { eventCode: 'auth.otp', channel: 'sms', isEnabled: true },        // a duplicate cell: the first one counts
      { eventCode: 'order.packed', channel: 'email', isEnabled: false },
      { eventCode: 'nope', channel: 'push', isEnabled: false },
      { eventCode: 'order.packed', channel: 'sms', isEnabled: false },
      { eventCode: 'order.packed', channel: 'push', isEnabled: false },   // already off: no change, no diff row
    ] });
    expect(r.refusals).toEqual([{ field: 'auth.otp::sms', code: 'CANNOT_OPT_OUT' }, { field: 'order.packed::email', code: 'CHANNEL_NOT_SENT' }, { field: 'nope::push', code: 'EVENT_UNKNOWN' }]);
    expect(r.diff).toEqual([{ field: 'order.packed::sms', before: 'on', after: 'off' }]);
    expect(r.changes).toEqual([{ eventCode: 'order.packed', channel: 'sms', isEnabled: false, before: true, locked: false }]);
    expect(r.fields.map((f) => f.name)).toEqual(['auth.otp::sms', 'order.packed::email', 'nope::push', 'order.packed::sms', 'order.packed::push']);
    // switching a locked event ON is not an opt-out
    expect(reviewPreferences({ catalog, explicit: new Map(), changes: [{ eventCode: 'auth.otp', channel: 'sms', isEnabled: true }] }).refusals).toEqual([{ field: null, code: 'NOTHING_CHANGED' }]);
    expect(reviewPreferences({ catalog, explicit, changes: [{ eventCode: 'order.packed', channel: 'push', isEnabled: true }] }).ready).toBe(true);
  });
  it('Change language: the ACTIVE registry; unchanged refused; whether the cooperative writes in it', () => {
    const base = { active: ['en', 'hi', 'gu'], tenantLanguages: ['gu'], current: 'hi' };
    expect(reviewLanguage({ ...base, entered: ' GU ' })).toMatchObject({ ready: true, tenantSpeaks: true, diff: [{ field: 'languageCode', before: 'hi', after: 'gu' }] });
    expect(reviewLanguage({ ...base, entered: 'en' })).toMatchObject({ ready: true, tenantSpeaks: false });
    expect(reviewLanguage({ ...base, entered: 'mr' }).refusals).toEqual([{ field: 'languageCode', code: 'LANGUAGE_UNKNOWN' }]);
    expect(reviewLanguage({ ...base, entered: 'hi' }).refusals).toEqual([{ field: 'languageCode', code: 'LANGUAGE_UNCHANGED' }]);
    expect(reviewLanguage({ ...base, entered: '' }).refusals).toEqual([{ field: 'languageCode', code: 'LANGUAGE_REQUIRED' }]);
    expect(reviewLanguage({ ...base, current: null, entered: 'gu' }).diff).toBeNull();
  });
});

describe('the state machine and the entity', () => {
  it('read is reachable from sent and delivered only; a suppression can be RELEASED (queued) and nothing else', () => {
    expect(statusesThatCanBecome('read')).toEqual(['sent', 'delivered']);
    expect(canTransition('suppressed', 'queued')).toBe(true);
    expect(canTransition('suppressed', 'sent')).toBe(false);
    expect(canTransition('sent', 'failed')).toBe(true);
  });
  const fresh = () => Notification.queue({ id: 'n1', tenantId: 't', userId: 'u', eventCode: 'order.confirmed', channel: 'push', templateId: null, languageCode: 'en', payload: {}, fanoutKey: 'k' });
  it('a quiet-hours suppression must carry its end; release only a quiet hold, once', () => {
    expect(() => fresh().markSuppressed('quiet_hours', null)).toThrow();
    const h = fresh(); h.markSuppressed('quiet_hours', at('2026-10-01T00:30:00Z'));
    expect(h.toProps()).toMatchObject({ status: 'suppressed', suppressedReason: 'quiet_hours', heldUntil: at('2026-10-01T00:30:00Z') });
    h.release(at('2026-10-01T00:31:00Z'));
    expect(h.toProps()).toMatchObject({ status: 'queued', releasedAt: at('2026-10-01T00:31:00Z'), suppressedReason: 'quiet_hours' });
    expect(() => h.release()).toThrow();
    const o = fresh(); o.markSuppressed('opted_out', at('2026-10-01T00:30:00Z'));
    expect(o.toProps().heldUntil).toBeNull();                 // only a quiet-hours suppression holds
    expect(() => o.release()).toThrow();
    expect(() => o.rehold(at('2026-10-01T01:00:00Z'))).toThrow();
    expect(() => o.dropHoldAsOptedOut()).toThrow();
    const r = fresh(); r.markSuppressed('quiet_hours', at('2026-10-01T00:30:00Z')); r.rehold(at('2026-10-01T01:30:00Z'));
    expect(r.toProps().heldUntil).toEqual(at('2026-10-01T01:30:00Z'));
    r.dropHoldAsOptedOut();
    expect(r.toProps()).toMatchObject({ status: 'suppressed', suppressedReason: 'opted_out', heldUntil: null });
    expect(r.pullEvents().map((e) => e.type)).toEqual(['comm.notification_queued', 'comm.notification_suppressed']);
  });
  it('the provider\'s receipt: delivered with its time; failed with a CODE and a time; the raw words only on the event', () => {
    const d = fresh(); d.markSent('ref', null); d.markDelivered(at('2026-10-01T01:00:00Z'));
    expect(d.toProps()).toMatchObject({ status: 'delivered', deliveredAt: at('2026-10-01T01:00:00Z') });
    const f = fresh(); f.markSent('ref', null); f.markFailedByProvider('Number blocked by operator');
    expect(f.toProps()).toMatchObject({ status: 'failed', failureReason: 'provider_rejected' });
    expect(f.toProps().failedAt).toBeInstanceOf(Date);
    expect(f.pullEvents().pop()!.payload).toMatchObject({ reason: 'provider_rejected', detail: 'Number blocked by operator', source: 'provider' });
    const g = fresh(); g.markFailed('no_device');
    expect(g.toProps().failureReason).toBe('no_device');
    expect(() => fresh().attachTemplate('t', 'v', 'gu')).not.toThrow();
    const s = fresh(); s.markSent(null, null);
    expect(() => s.attachTemplate('t', 'v', 'gu')).toThrow();
  });
});

describe('the cursor carries the instant exactly', () => {
  it('round-trips microseconds and refuses junk', () => {
    const c = encodeInboxCursor('2026-10-01T02:10:00.123456Z', '01900000-0000-7000-8000-000000000001');
    expect(decodeInboxCursor(c)).toEqual({ c: '2026-10-01T02:10:00.123456Z', id: '01900000-0000-7000-8000-000000000001' });
    expect(decodeInboxCursor(Buffer.from('not-a-date|x').toString('base64'))).toBeUndefined();
    expect(decodeInboxCursor(Buffer.from('2026-10-01T00:00:00Z|not-an-id').toString('base64'))).toBeUndefined();
    expect(decodeInboxCursor(undefined)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------------------------------------------ */
/* THE SPINE WITH FAKES — the default window, the sanitiser, the fallback hold                                  */
/* ------------------------------------------------------------------------------------------------------------ */
function spine(o: { event: NotificationEvent; own?: Map<string, { starts: string; ends: string; timezone: string }>; tenantDefault?: unknown; zone?: string | null; clock: Date; routine?: boolean; dispatch?: 'accepted' | 'failed' }) {
  const inserted: Notification[] = [];
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  const svc = new NotificationService(
    { run: jest.fn() } as any, { write: jest.fn() } as any, metrics as any,
    { providerCode: 'f', dispatch: jest.fn(async () => ({ status: o.dispatch ?? 'accepted', providerMsgRef: 'r' })) } as any,
    { providerCode: 'f', send: jest.fn(async () => ({ sent: o.dispatch === 'failed' ? 0 : 1, invalidTokens: [], failureReason: o.dispatch === 'failed' ? 'push_unavailable' : undefined })) } as any,
    { activeTokensForUser: jest.fn(async () => [{ token: 't', platform: 'android' }]), deactivate: jest.fn() } as any,
    { getByCode: jest.fn(async () => o.event) } as any,
    { resolve: jest.fn(async (_t: unknown, e: string, ch: NotifChannel) => NotificationTemplate.rehydrate({ id: `t-${ch}`, eventCode: e, channel: ch, languageCode: 'en', tenantId: null, subject: null, body: 'b', providerTemplateRef: null, isActive: true })), tenantLanguageOrder: jest.fn(async () => []) } as any,
    { mapForUsers: jest.fn(async () => new Map()) } as any,
    { mapForUsers: jest.fn(async () => o.own ?? new Map()), tenantContext: jest.fn(async () => ({ zone: o.zone === undefined ? IST : o.zone, defaultWindow: o.tenantDefault === undefined ? { starts: '21:00', ends: '06:00' } : o.tenantDefault })) } as any,
    { insert: jest.fn(async (_tx: unknown, n: Notification) => { inserted.push(n); }), profilesFor: jest.fn(async (_tx: unknown, ids: string[]) => new Map(ids.map((id) => [id, { languageCode: 'en', hasEmail: true, hasPhone: true }]))) } as any,
    { isEnabled: jest.fn(async () => o.routine ?? false) } as any,
    () => o.clock,
  );
  return { svc, inserted, metrics };
}
const ev = (over: Partial<{ priority: any; defaultChannels: NotifChannel[] }> = {}) => NotificationEvent.rehydrate({ code: 'order.confirmed', defaultName: 'x', priority: 'important', defaultChannels: ['push', 'sms', 'inapp'], userCanOptOut: true, batchable: false, ...over });
const fan = (s: ReturnType<typeof spine>, recipients = ['u1']) => s.svc.fanout({ query: jest.fn() } as any, { tenantId: 't1', eventCode: 'order.confirmed', recipients, payload: {}, dedupeKey: 'evt-1' });
const shape = (ns: Notification[]) => ns.map((n) => [n.userId, n.toProps().channel, n.status, n.toProps().suppressedReason ?? null]);

describe('the fan-out · F-5, F-4, F-6 with the injected clock', () => {
  const NIGHT = at('2026-09-30T16:30:00Z'); const NOON = at('2026-09-30T06:30:00Z');
  it('a member with no row is quiet in the cooperative\'s default: push and SMS held until 06:00, in-app sent, one delivery key', async () => {
    const s = spine({ event: ev(), clock: NIGHT });
    await fan(s);
    expect(shape(s.inserted)).toEqual([['u1', 'inapp', 'sent', null], ['u1', 'push', 'suppressed', 'quiet_hours'], ['u1', 'sms', 'suppressed', 'quiet_hours']]);
    expect(s.inserted[1].toProps().heldUntil).toEqual(at('2026-10-01T00:30:00Z'));
    expect(new Set(s.inserted.map((n) => n.toProps().fanoutKey))).toEqual(new Set([fanoutKeyOf('evt-1', 'u1')]));
  });
  it('at noon nothing is held; a cooperative that switched its default off (starts = ends) is never quiet', async () => {
    const a = spine({ event: ev(), clock: NOON }); await fan(a);
    expect(a.inserted.every((n) => n.status === 'sent')).toBe(true);
    const b = spine({ event: ev(), clock: NIGHT, tenantDefault: { starts: '00:00', ends: '00:00' } }); await fan(b);
    expect(b.inserted.every((n) => n.status === 'sent')).toBe(true);
  });
  it('critical bypasses; a platform notice (no cooperative) with no own row is never quiet', async () => {
    const c = spine({ event: ev({ priority: 'critical' }), clock: NIGHT }); await fan(c);
    expect(c.inserted.every((n) => n.status === 'sent')).toBe(true);
    const p = spine({ event: ev(), clock: NIGHT, tenantDefault: null, zone: null }); await fan(p);
    expect(p.inserted.every((n) => n.status === 'sent')).toBe(true);
  });
  it('F-6 · a typo\'d zone does not throw: the member is read in the cooperative\'s zone, reported, and the neighbour still gets rows', async () => {
    const s = spine({ event: ev(), clock: NIGHT, own: new Map([['u1', W('21:00', '06:00', 'Asia/Kolkatta')]]) });
    await expect(fan(s, ['u1', 'u2'])).resolves.toBeUndefined();
    expect(shape(s.inserted).filter((r) => r[0] === 'u1')).toEqual([['u1', 'inapp', 'sent', null], ['u1', 'push', 'suppressed', 'quiet_hours'], ['u1', 'sms', 'suppressed', 'quiet_hours']]);
    expect(s.inserted.filter((n) => n.userId === 'u2')).toHaveLength(3);
    expect(s.metrics.inc).toHaveBeenCalledWith('comm.quiet_hours.timezone_sanitised', { event: 'order.confirmed' });
    expect(s.metrics.inc.mock.calls.filter((c: any[]) => c[0] === 'comm.quiet_hours.timezone_sanitised')).toHaveLength(1);
  });
  it('the routine rule at night: a failed primary\'s SMS fallback is HELD for the morning, not fired at 22:00', async () => {
    // daytime: the push fails, the fallback SMS is attempted (and fails too here — the fake notifier refuses everything)
    const d = spine({ event: ev({ priority: 'informational', defaultChannels: ['push', 'inapp'] }), clock: NOON, routine: true, dispatch: 'failed' });
    await fan(d);
    expect(shape(d.inserted)).toEqual([['u1', 'inapp', 'sent', null], ['u1', 'push', 'failed', null], ['u1', 'sms', 'failed', null]]);
    // night, primary push: it is held itself, so nothing failed and there is no fallback at all
    const n = spine({ event: ev({ priority: 'informational', defaultChannels: ['push', 'inapp'] }), clock: NIGHT, routine: true, dispatch: 'failed' });
    await fan(n);
    expect(shape(n.inserted)).toEqual([['u1', 'inapp', 'sent', null], ['u1', 'push', 'suppressed', 'quiet_hours']]);
    // night, primary email (never held): it fails, and the SMS fallback waits for 06:00 instead of ringing now
    const e = spine({ event: ev({ priority: 'informational', defaultChannels: ['email', 'inapp'] }), clock: NIGHT, routine: true, dispatch: 'failed' });
    await fan(e);
    expect(shape(e.inserted)).toEqual([['u1', 'inapp', 'sent', null], ['u1', 'email', 'failed', null], ['u1', 'sms', 'suppressed', 'quiet_hours']]);
    expect(e.inserted[2].toProps().heldUntil).toEqual(at('2026-10-01T00:30:00Z'));
  });
  it('resolveChannels still decides opt-outs before quiet hours', () => {
    const d = resolveChannels({ code: 'x', priority: 'important', defaultChannels: ['push', 'sms', 'email'], userCanOptOut: true }, new Map([['sms', false]]), eff('21:00', '06:00'), NIGHT);
    expect(d).toEqual({ channels: ['email'], suppressed: [{ channel: 'push', reason: 'quiet_hours' }, { channel: 'sms', reason: 'opted_out' }] });
  });
});

describe('InboxService with fakes', () => {
  const svc = (getForUserUpdate = jest.fn(async () => null)) => new InboxService(
    { run: jest.fn(async (_t: string, fn: any) => fn({ query: jest.fn() })) } as any, { write: jest.fn() } as any, { write: jest.fn() } as any,
    { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) } as any, { inc: jest.fn() } as any,
    { getForUserUpdate, tenantHealth: jest.fn(async () => []) } as any, { list: jest.fn() } as any, { releaseStopped: jest.fn(async () => false) } as any);
  it('mark read 404s for a non-owner (no cross-user IDOR) and for a non-id', async () => {
    await expect(svc().markRead('t1', { userId: 'u1', canManage: false }, '01900000-0000-7000-8000-000000000001')).rejects.toMatchObject({ code: 'NOTIFICATION_NOT_FOUND' });
    const g = jest.fn(async () => null);
    await expect(svc(g).markRead('t1', { userId: 'u1', canManage: false }, 'n-does-not-exist')).rejects.toMatchObject({ code: 'NOTIFICATION_NOT_FOUND' });
    expect(g).not.toHaveBeenCalled();                       // a non-id never reaches Postgres (22P02 would be a 500)
  });
  it('the tenant health tiles are notification.manage — refused with a sentence otherwise', async () => {
    await expect(svc().health('t1', { userId: 'u1', canManage: false })).rejects.toMatchObject({ code: 'COMM_FORBIDDEN' });
    await expect(svc().health('t1', { userId: 'u1', canManage: true })).resolves.toMatchObject({ hours: 24, leftPlatform: 0 });
  });
  it('the ladder needs an id AND an instant (one partition), else not found', async () => {
    await expect(svc().ladder('t1', 'u1', 'n1', '2026-10-01T00:00:00Z')).rejects.toMatchObject({ code: 'NOTIFICATION_NOT_FOUND' });
    await expect(svc().ladder('t1', 'u1', '01900000-0000-7000-8000-000000000001', undefined)).rejects.toMatchObject({ code: 'NOTIFICATION_NOT_FOUND' });
    await expect(svc().ladder('t1', 'u1', '01900000-0000-7000-8000-000000000001', 'not-a-time')).rejects.toMatchObject({ code: 'NOTIFICATION_NOT_FOUND' });
  });
});
