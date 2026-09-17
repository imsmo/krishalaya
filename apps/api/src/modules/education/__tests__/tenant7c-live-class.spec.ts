// modules/education/__tests__/tenant7c-live-class.spec.ts · PC-56 TENANT-7c · THE LIVE CLASS — the pure logic: the clock
// (a wall-clock's shape, intervals, the clash, the join window, the reminder offsets), the review (one function for
// preview and write), the acts (verdicts in the order a person wants to hear them), the state machine's honest edge, and
// the guard that reads the reminder templates out of seed 0007 and renders them against the variables the job emits.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CAPACITY_NEEDS_DESK_ABOVE, DEFAULT_DURATION_MINS, beforeStart, clashesWith, intervalOf, isWithin, joinWindowOf, noticeDayText, overlaps, parseAttendance, parseCapacity,
  parseDateOnly, parseDurationMins, parseJoinUrl, parseWallTime, reminderOffsets, remindersDue, startTooEarly,
} from '../domain/live-clock';
import { CurrentClass, LIVE_FORM_FIELDS, LIVE_REVIEW_REFUSALS, LiveReviewInput, addMinutesToWall, liveFormValues, reviewLiveClass, storedLiveClass } from '../domain/live-class-review';
import { LIVE_ACTS, LIVE_ACT_REFUSALS, LiveActInput, allLiveVerdicts, isLiveAct, liveActVerdict } from '../domain/live-class-acts';
import { canTransition, isOnCalendar } from '../domain/live-session.state';
import { LiveSession } from '../domain/live-session.entity';
import { NotificationTemplate } from '../../communication/domain/notification-template.entity';
import { NotifChannel } from '../../communication/domain/communication.events';
import { NOTIFICATION_EVENT_MAP } from '../../communication/events/notification-event-map';
import { LIVE_REMINDER_EVENT } from '../services/live-session.service';

const T = (s: string) => new Date(s);
const NOW = T('2026-07-10T12:00:00Z');
const START = T('2026-07-16T15:00:00Z');   // 20:30 IST on 16 July

/* --------------------------------------------------------------------------------------------------------- */
describe('live-clock · the wall-clock a host types', () => {
  it('a date is a real calendar day', () => {
    expect(parseDateOnly('2026-07-16')).toBe('2026-07-16');
    expect(parseDateOnly(' 2026-07-16 ')).toBe('2026-07-16');
    for (const bad of ['2026-02-30', '2026-13-01', '16/07/2026', '2026-7-16', '', null, undefined, '1999-01-01', '2026-00-10']) expect(parseDateOnly(bad)).toBeNull();
  });
  it('a time is HH:MM, 24-hour, normalised', () => {
    expect(parseWallTime('20:30')).toBe('20:30'); expect(parseWallTime('8:05')).toBe('08:05'); expect(parseWallTime('0:00')).toBe('00:00'); expect(parseWallTime('23:59')).toBe('23:59');
    for (const bad of ['24:00', '20:60', '20', '8pm', '20:30:00', '', null]) expect(parseWallTime(bad)).toBeNull();
  });
  it('duration, capacity, attendance are whole numbers in their ranges', () => {
    expect(parseDurationMins('90')).toBe(90); expect(parseDurationMins('5')).toBe(5); expect(parseDurationMins('480')).toBe(480);
    for (const bad of ['4', '481', '0', '-5', '1.5', 'x', '']) expect(parseDurationMins(bad)).toBeNull();
    expect(parseCapacity('500')).toBe(500); expect(parseCapacity('1')).toBe(1); expect(parseCapacity('100000')).toBe(100000);
    for (const bad of ['0', '100001', '-1', '2.5', '']) expect(parseCapacity(bad)).toBeNull();
    expect(parseAttendance('0')).toBe(0); expect(parseAttendance('342')).toBe(342);
    expect(parseAttendance('1000000')).toBe(1_000_000);
    for (const bad of ['-1', '1.5', '', 'abc', '10000001', '1000001']) expect(parseAttendance(bad)).toBeNull();   // the ceiling, not only the digit count (mutation pass)
  });
  it('the join link is https, no whitespace, a host', () => {
    expect(parseJoinUrl('https://meet.example/abc')).toBe('https://meet.example/abc');
    for (const bad of ['http://meet.example/abc', 'meet.example/abc', 'https://', 'https://a b.example', '', null, 'javascript:alert(1)']) expect(parseJoinUrl(bad)).toBeNull();
    expect(parseJoinUrl(`https://x.example/${'a'.repeat(500)}`)).toBeNull();
  });
});

describe('live-clock · intervals, the clash, the window', () => {
  const a = intervalOf(START, 90);
  it('an interval is [start, start + duration)', () => { expect(a.endsAt.toISOString()).toBe('2026-07-16T16:30:00.000Z'); });
  it('overlap is strict: touching is not a clash', () => {
    expect(overlaps(a, intervalOf(T('2026-07-16T16:30:00Z'), 60))).toBe(false);   // starts as a ends
    expect(overlaps(a, intervalOf(T('2026-07-16T14:00:00Z'), 60))).toBe(false);   // ends as a starts
    expect(overlaps(a, intervalOf(T('2026-07-16T16:29:00Z'), 60))).toBe(true);
    expect(overlaps(a, intervalOf(T('2026-07-16T14:01:00Z'), 60))).toBe(true);
    expect(overlaps(a, intervalOf(T('2026-07-16T15:30:00Z'), 5))).toBe(true);      // inside
    expect(overlaps(a, intervalOf(T('2026-07-16T14:00:00Z'), 240))).toBe(true);    // around
  });
  it('the clash is against the OTHER classes, never the class itself', () => {
    const others = [
      { id: 'me', title: 'me', startsAt: START, durationMins: 90 },
      { id: 'x', title: 'Monsoon feeding', startsAt: T('2026-07-16T16:00:00Z'), durationMins: 60 },
      { id: 'y', title: 'Far away', startsAt: T('2026-07-17T15:00:00Z'), durationMins: 60 },
    ];
    expect(clashesWith(a, others, 'me').map((o) => o.id)).toEqual(['x']);
    expect(clashesWith(a, others, null).map((o) => o.id)).toEqual(['me', 'x']);
  });
  it('the window opens 15 minutes before and closes 30 after; start may not be taken more than 15 early', () => {
    const w = joinWindowOf(a);
    expect(w.opensAt.toISOString()).toBe('2026-07-16T14:45:00.000Z'); expect(w.closesAt.toISOString()).toBe('2026-07-16T17:00:00.000Z');
    expect(isWithin(T('2026-07-16T14:44:59Z'), w)).toBe(false); expect(isWithin(T('2026-07-16T14:45:00Z'), w)).toBe(true);
    expect(isWithin(T('2026-07-16T17:00:00Z'), w)).toBe(true); expect(isWithin(T('2026-07-16T17:00:01Z'), w)).toBe(false);
    expect(startTooEarly(T('2026-07-16T14:44:00Z'), START)).toBe(true); expect(startTooEarly(T('2026-07-16T14:45:00Z'), START)).toBe(false);
    expect(beforeStart(T('2026-07-16T14:59:59Z'), START)).toBe(true); expect(beforeStart(START, START)).toBe(false);
  });
});

describe('live-clock · the reminder cadence', () => {
  it('offsets come from the setting, largest first, up to three, junk dropped, named day · hour · soon', () => {
    expect(reminderOffsets([1440, 60, 10])).toEqual([{ kind: 'day', mins: 1440 }, { kind: 'hour', mins: 60 }, { kind: 'soon', mins: 10 }]);
    expect(reminderOffsets([10, '60', 1440, 1440, -5, 0, 1.5, 'x', 99999999])).toEqual([{ kind: 'day', mins: 1440 }, { kind: 'hour', mins: 60 }, { kind: 'soon', mins: 10 }]);
    expect(reminderOffsets([30])).toEqual([{ kind: 'day', mins: 30 }]);
    expect(reminderOffsets([])).toEqual([]); expect(reminderOffsets(null)).toEqual([]); expect(reminderOffsets('nope')).toEqual([]);
    expect(reminderOffsets([5, 4, 3, 2])).toHaveLength(3);
  });
  it('a reminder is due once its offset is reached, never after the start, never twice', () => {
    const offsets = reminderOffsets([1440, 60, 10]);
    expect(remindersDue(T('2026-07-15T14:59:59Z'), START, offsets, new Set())).toEqual([]);
    expect(remindersDue(T('2026-07-15T15:00:00Z'), START, offsets, new Set())).toEqual(['day']);
    expect(remindersDue(T('2026-07-16T14:05:00Z'), START, offsets, new Set(['day']))).toEqual(['hour']);
    expect(remindersDue(T('2026-07-16T14:05:00Z'), START, offsets, new Set())).toEqual(['day', 'hour']);   // a class scheduled late owes both at once
    expect(remindersDue(T('2026-07-16T14:50:00Z'), START, offsets, new Set(['day', 'hour']))).toEqual(['soon']);
    expect(remindersDue(START, START, offsets, new Set())).toEqual([]);
    expect(remindersDue(T('2026-07-16T15:01:00Z'), START, offsets, new Set())).toEqual([]);
  });
  it('the notice prints DD/MM from the wall-clock the database resolved', () => { expect(noticeDayText('2026-07-16')).toBe('16/07'); expect(noticeDayText('bad')).toBe('bad'); });
});

/* --------------------------------------------------------------------------------------------------------- */
const RESOLVED = { startsAt: START, timezone: 'Asia/Kolkata' };
const base = (o: Partial<LiveReviewInput> = {}): LiveReviewInput => ({
  canAuthor: true, canPublish: false, isOwner: true, course: { status: 'draft', instructorUserId: 'host' }, current: undefined,
  entered: { courseId: 'c1', title: 'Mastitis: spot it early', date: '2026-07-16', time: '20:30', durationMins: '90', capacity: '500', joinUrl: 'https://meet.example/mastitis', remind: '1' },
  resolved: RESOLVED, others: [], now: NOW, ...o,
});
const codes = (i: LiveReviewInput) => reviewLiveClass(i).refusals;
const stored = (i: LiveReviewInput, name: string) => reviewLiveClass(i).fields.find((f) => f.name === name)?.stored ?? null;

describe('live-class-review · one function for preview and write', () => {
  it('a ready review shows the instant in the cooperative zone AND as the row will hold it, the end, the normalised time', () => {
    const r = reviewLiveClass(base({ entered: { ...base().entered, time: '8:30' } }));
    expect(r.ready).toBe(true); expect(r.entityType).toBe('live_session'); expect(r.diff).toBeNull();
    expect(stored(base(), 'startsAt')).toBe('2026-07-16 20:30 Asia/Kolkata · 2026-07-16T15:00:00.000Z');
    expect(stored(base(), 'endsAt')).toBe('22:00');
    expect(r.fields.find((f) => f.name === 'time')).toMatchObject({ entered: '8:30', stored: '08:30', normalised: true });
    expect(stored(base(), 'remind')).toBe('on'); expect(stored(base({ entered: { ...base().entered, remind: undefined } }), 'remind')).toBe('off');
    expect(stored(base(), 'clash')).toBeNull(); expect(stored(base(), 'clashAccepted')).toBeNull();
    expect(r.fields.map((f) => f.name)).toEqual(['courseId', 'title', 'date', 'time', 'startsAt', 'durationMins', 'endsAt', 'capacity', 'joinUrl', 'remind', 'clashAccepted', 'clash']);
  });
  it('the end crosses midnight honestly', () => { expect(addMinutesToWall('23:30', 60)).toEqual({ time: '00:30', nextDay: true }); expect(addMinutesToWall('20:30', 90)).toEqual({ time: '22:00', nextDay: false }); });
  it('every refusal is reachable and named: permission, course, host, the clock, the numbers, the link', () => {
    expect(codes(base({ canAuthor: false }))).toEqual([{ field: null, code: 'NO_AUTHOR' }]);
    expect(codes(base({ isOwner: false }))).toEqual([{ field: null, code: 'NOT_OWNER' }]);
    expect(codes(base({ isOwner: false, canPublish: true }))).toEqual([]);   // the desk schedules on any course
    expect(codes(base({ canAuthor: false, canPublish: true, isOwner: false }))).toEqual([]);   // …even without course.author (mutation pass)
    expect(codes(base({ course: undefined, entered: { ...base().entered, courseId: '' } }))).toEqual([{ field: 'courseId', code: 'COURSE_REQUIRED' }]);
    expect(codes(base({ course: null }))).toEqual([{ field: 'courseId', code: 'COURSE_NOT_FOUND' }]);
    expect(codes(base({ course: { status: 'archived', instructorUserId: 'host' } }))).toEqual([{ field: 'courseId', code: 'COURSE_ARCHIVED' }]);
    expect(codes(base({ course: { status: 'draft', instructorUserId: null } }))).toEqual([{ field: 'courseId', code: 'HOST_UNKNOWN' }]);
    expect(codes(base({ entered: { ...base().entered, title: '  ' } }))).toEqual([{ field: 'title', code: 'TITLE_REQUIRED' }]);
    expect(codes(base({ entered: { ...base().entered, date: '' }, resolved: undefined }))).toEqual([{ field: 'date', code: 'DATE_REQUIRED' }]);
    expect(codes(base({ entered: { ...base().entered, date: '16/07/2026' }, resolved: undefined }))).toEqual([{ field: 'date', code: 'DATE_INVALID' }]);
    expect(codes(base({ entered: { ...base().entered, time: '' }, resolved: undefined }))).toEqual([{ field: 'time', code: 'TIME_REQUIRED' }]);
    expect(codes(base({ entered: { ...base().entered, time: '25:00' }, resolved: undefined }))).toEqual([{ field: 'time', code: 'TIME_INVALID' }]);
    expect(codes(base({ resolved: null }))).toEqual([{ field: 'time', code: 'ZONE_UNKNOWN' }]);
    expect(codes(base({ resolved: { startsAt: T('2026-07-01T15:00:00Z'), timezone: 'Asia/Kolkata' } }))).toEqual([{ field: 'time', code: 'STARTS_IN_PAST' }]);
    expect(codes(base({ entered: { ...base().entered, durationMins: '3' } }))).toEqual([{ field: 'durationMins', code: 'DURATION_INVALID' }]);
    expect(codes(base({ entered: { ...base().entered, capacity: '0' } }))).toEqual([{ field: 'capacity', code: 'CAPACITY_INVALID' }]);
    expect(codes(base({ entered: { ...base().entered, joinUrl: 'http://meet.example' } }))).toEqual([{ field: 'joinUrl', code: 'JOIN_URL_INVALID' }]);
    // several at once — every one, not the first
    expect(codes(base({ canAuthor: false, entered: { title: '', date: 'x', time: 'y' }, resolved: undefined, course: undefined })).map((r) => r.code)).toEqual(['NO_AUTHOR', 'COURSE_REQUIRED', 'TITLE_REQUIRED', 'DATE_INVALID', 'TIME_INVALID']);
    for (const c of codes(base({ canAuthor: false, entered: { title: '', date: 'x', time: 'y', capacity: 'z', joinUrl: 'q', durationMins: '0' }, resolved: undefined, course: null }))) expect(LIVE_REVIEW_REFUSALS).toContain(c.code);
  });
  it('a blank duration is the default (60) and shown as normalised; a blank capacity stores nothing', () => {
    const r = reviewLiveClass(base({ entered: { ...base().entered, durationMins: '', capacity: '' } }));
    expect(r.ready).toBe(true);
    expect(r.fields.find((f) => f.name === 'durationMins')).toMatchObject({ entered: null, stored: String(DEFAULT_DURATION_MINS), normalised: true });
    expect(r.fields.find((f) => f.name === 'capacity')).toMatchObject({ entered: null, stored: null });
    expect(storedLiveClass(base({ entered: { ...base().entered, durationMins: '', capacity: '' } }))).toMatchObject({ durationMins: 60, capacity: null });
  });
  it('W414 "capacity above 500 needs tenant approval" is the desk\'s key, at the boundary', () => {
    expect(codes(base({ entered: { ...base().entered, capacity: String(CAPACITY_NEEDS_DESK_ABOVE) } }))).toEqual([]);
    expect(codes(base({ entered: { ...base().entered, capacity: '501' } }))).toEqual([{ field: 'capacity', code: 'CAPACITY_NEEDS_DESK' }]);
    expect(codes(base({ canPublish: true, entered: { ...base().entered, capacity: '501' } }))).toEqual([]);
  });
  it('W414 "Time clash — Schedule anyway": the host\'s other class refuses until accepted; the acceptance is stored only where there was a clash', () => {
    const others = [{ id: 'x', title: 'Monsoon feeding: live Q&A', startsAt: T('2026-07-16T16:00:00Z'), durationMins: 60 }];
    const clash = base({ others });
    expect(codes(clash)).toEqual([{ field: 'clashAccepted', code: 'HOST_CLASH' }]);
    expect(stored(clash, 'clash')).toBe('Monsoon feeding: live Q&A · 2026-07-16T16:00:00.000Z · 60 min');
    expect(storedLiveClass(clash)).toBeNull();
    const accepted = base({ others, entered: { ...base().entered, clashAccepted: '1' } });
    expect(codes(accepted)).toEqual([]); expect(stored(accepted, 'clashAccepted')).toBe('accepted');
    expect(storedLiveClass(accepted)).toMatchObject({ clashAccepted: true, hostUserId: 'host', courseId: 'c1', scheduledAt: START, durationMins: 90, capacity: 500, joinUrl: 'https://meet.example/mastitis', remind: true });
    // a stale tick on a free slot does not survive
    expect(storedLiveClass(base({ entered: { ...base().entered, clashAccepted: '1' } }))).toMatchObject({ clashAccepted: false });
    // touching is not a clash
    expect(codes(base({ others: [{ id: 'x', title: 't', startsAt: T('2026-07-16T16:30:00Z'), durationMins: 60 }] }))).toEqual([]);
  });
  const current: CurrentClass = { id: 'me', status: 'scheduled', courseId: 'c1', hostUserId: 'host', title: 'Mastitis: spot it early', scheduledAt: START, durationMins: 90, capacity: 500, joinUrl: 'https://meet.example/mastitis', clashAccepted: false, remind: true, localDate: '2026-07-16', localTime: '20:30' };
  it('an EDIT keeps the course, excludes itself from the clash, allows an unchanged past start, and diffs the changed fields only', () => {
    const same = base({ current, entered: { ...base().entered, courseId: undefined }, others: [{ id: 'me', title: 'me', startsAt: START, durationMins: 90 }], now: T('2026-07-20T00:00:00Z') });
    const r = reviewLiveClass(same);
    expect(r.ready).toBe(true); expect(r.diff).toEqual([]);
    const moved = base({ current, entered: { ...base().entered, title: 'Mastitis: spot it early (II)', capacity: '', remind: undefined }, resolved: { startsAt: T('2026-07-17T15:00:00Z'), timezone: 'Asia/Kolkata' } });
    const d = reviewLiveClass(moved).diff!;
    expect(d.map((x) => x.field)).toEqual(['title', 'startsAt', 'capacity', 'remind']);
    expect(d[1]).toEqual({ field: 'startsAt', before: '2026-07-16T15:00:00.000Z', after: '2026-07-17T15:00:00.000Z' });
    expect(d[2]).toEqual({ field: 'capacity', before: '500', after: null });
    // a moved start in the past is refused; an untouched one is not
    expect(codes(base({ current, resolved: { startsAt: T('2026-07-01T15:00:00Z'), timezone: 'Asia/Kolkata' } }))).toEqual([{ field: 'time', code: 'STARTS_IN_PAST' }]);
    expect(codes(base({ current: null }))).toEqual([{ field: null, code: 'CLASS_NOT_FOUND' }]);
    expect(codes(base({ current: { ...current, status: 'ended' } }))).toEqual([{ field: null, code: 'CLASS_NOT_SCHEDULED' }]);
  });
  it('the form opens with the row as it stands, in the cooperative\'s wall-clock', () => {
    expect(liveFormValues(current)).toEqual({ courseId: 'c1', title: 'Mastitis: spot it early', date: '2026-07-16', time: '20:30', durationMins: '90', capacity: '500', joinUrl: 'https://meet.example/mastitis', remind: '1', clashAccepted: '' });
    expect(Object.keys(liveFormValues(current)).sort()).toEqual([...LIVE_FORM_FIELDS].sort());
  });
  it('the writer\'s complaints ride along as TOO_LONG / VALUE_REJECTED, never over a precise reason', () => {
    const r = reviewLiveClass(base({ writerIssues: [{ path: 'title', tooLong: true }, { path: 'joinUrl', tooLong: false }, { path: 'nonsense', tooLong: false }] }));
    expect(r.refusals).toEqual([{ field: 'title', code: 'TOO_LONG' }, { field: 'joinUrl', code: 'VALUE_REJECTED' }, { field: null, code: 'VALUE_REJECTED' }]);
    const precise = reviewLiveClass(base({ entered: { ...base().entered, joinUrl: 'nope' }, writerIssues: [{ path: 'joinUrl', tooLong: false }] }));
    expect(precise.refusals).toEqual([{ field: 'joinUrl', code: 'JOIN_URL_INVALID' }]);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
const act = (o: Partial<LiveActInput> = {}): LiveActInput => ({
  act: 'end', canAuthor: true, canPublish: false, isHost: true, courseStatus: 'published', status: 'scheduled', scheduledAt: START, now: T('2026-07-16T16:40:00Z'),
  providerConfigured: false, hasRecording: false, recordingLessonId: null, media: undefined, recordingScanStatus: null, count: undefined, reason: 'held on the meet link, 40 attended', ...o,
});
const R = (o: Partial<LiveActInput>) => liveActVerdict(act(o)).refusals;

describe('live-class-acts · verdicts in the order a person wants to hear them', () => {
  it('permission → host → course → stage → what the act needs → the reason', () => {
    expect(R({ canAuthor: false, canPublish: false })).toEqual(['NO_PERMISSION']);
    expect(R({ canAuthor: false, canPublish: false, isHost: false })).toEqual(['NO_PERMISSION', 'NOT_HOST']);
    expect(R({ isHost: false })).toEqual(['NOT_HOST']);
    expect(R({ isHost: false, canPublish: true })).toEqual([]);
    expect(R({ courseStatus: 'archived' })).toEqual(['COURSE_ARCHIVED']);
    expect(R({ reason: 'ok' })).toEqual(['REASON_REQUIRED']); expect(R({ reason: 'x'.repeat(301) })).toEqual(['REASON_REQUIRED']); expect(R({ reason: 'x'.repeat(300) })).toEqual([]);
    for (const c of liveActVerdict(act({ act: 'to_lesson', canAuthor: false, isHost: false, courseStatus: 'archived', reason: '' })).refusals) expect(LIVE_ACT_REFUSALS).toContain(c);
  });
  it('start: the provider edge — refused by name where none is bound; not more than 15 minutes early', () => {
    expect(liveActVerdict(act({ act: 'start', now: T('2026-07-16T14:50:00Z') }))).toMatchObject({ allowed: false, refusals: ['PROVIDER_NOT_CONFIGURED'], to: 'live' });
    expect(R({ act: 'start', providerConfigured: true, now: T('2026-07-16T14:50:00Z') })).toEqual([]);
    expect(R({ act: 'start', providerConfigured: true, now: T('2026-07-16T14:44:00Z') })).toEqual(['TOO_EARLY']);
    expect(R({ act: 'start', providerConfigured: true, status: 'ended' })).toEqual(['ILLEGAL_FROM_STATUS']);
  });
  it('end: from live any time; from scheduled (held elsewhere) only once the start has passed', () => {
    expect(liveActVerdict(act({ act: 'end', status: 'live' }))).toMatchObject({ allowed: true, to: 'ended' });
    expect(R({ act: 'end', status: 'scheduled', now: T('2026-07-16T14:59:00Z') })).toEqual(['BEFORE_START']);
    expect(R({ act: 'end', status: 'scheduled', now: START })).toEqual([]);
    expect(R({ act: 'end', status: 'ended' })).toEqual(['ILLEGAL_FROM_STATUS']); expect(R({ act: 'end', status: 'cancelled' })).toEqual(['ILLEGAL_FROM_STATUS']);
  });
  it('cancel: only a scheduled class', () => {
    expect(liveActVerdict(act({ act: 'cancel' }))).toMatchObject({ allowed: true, to: 'cancelled' });
    expect(R({ act: 'cancel', status: 'live' })).toEqual(['ILLEGAL_FROM_STATUS']);
  });
  it('attendance: on an ended class, a whole number', () => {
    expect(R({ act: 'attendance', status: 'ended', count: '342' })).toEqual([]);
    expect(R({ act: 'attendance', status: 'ended', count: '0' })).toEqual([]);
    expect(R({ act: 'attendance', status: 'ended', count: '' })).toEqual(['ATTENDANCE_REQUIRED']);
    expect(R({ act: 'attendance', status: 'ended', count: '-1' })).toEqual(['ATTENDANCE_INVALID']);
    expect(R({ act: 'attendance', status: 'ended', count: '12.5' })).toEqual(['ATTENDANCE_INVALID']);
    expect(R({ act: 'attendance', status: 'scheduled', count: '3' })).toEqual(['ILLEGAL_FROM_STATUS']);
  });
  it('recording: on an ended class, a video or audio asset of THIS tenant, not once it is a lesson', () => {
    expect(R({ act: 'recording', status: 'ended', media: { kind: 'video', scanStatus: 'pending' } })).toEqual([]);
    expect(R({ act: 'recording', status: 'ended', media: { kind: 'audio', scanStatus: 'clean' } })).toEqual([]);
    expect(R({ act: 'recording', status: 'ended', media: undefined })).toEqual(['MEDIA_REQUIRED']);
    expect(R({ act: 'recording', status: 'ended', media: null })).toEqual(['MEDIA_UNKNOWN']);
    expect(R({ act: 'recording', status: 'ended', media: { kind: 'document', scanStatus: 'clean' } })).toEqual(['MEDIA_KIND_MISMATCH']);
    expect(R({ act: 'recording', status: 'ended', recordingLessonId: 'l1', media: { kind: 'video', scanStatus: 'clean' } })).toEqual(['LESSON_EXISTS']);
    expect(R({ act: 'recording', status: 'scheduled', media: { kind: 'video', scanStatus: 'clean' } })).toEqual(['ILLEGAL_FROM_STATUS']);
  });
  it('to_lesson: needs the recording, scanned clean, once', () => {
    expect(R({ act: 'to_lesson', status: 'ended', hasRecording: true, recordingScanStatus: 'clean' })).toEqual([]);
    expect(R({ act: 'to_lesson', status: 'ended' })).toEqual(['RECORDING_REQUIRED']);
    expect(R({ act: 'to_lesson', status: 'ended', hasRecording: true, recordingScanStatus: 'pending' })).toEqual(['MEDIA_NOT_CLEAN']);
    expect(R({ act: 'to_lesson', status: 'ended', hasRecording: true, recordingScanStatus: 'clean', recordingLessonId: 'l1' })).toEqual(['LESSON_EXISTS']);
    expect(R({ act: 'to_lesson', status: 'live', hasRecording: true, recordingScanStatus: 'clean' })).toEqual(['ILLEGAL_FROM_STATUS']);
  });
  it('the desk\'s list of verdicts covers every act and asks no question the confirm step owns', () => {
    const all = allLiveVerdicts({ canAuthor: true, canPublish: false, isHost: true, courseStatus: 'published', status: 'ended', scheduledAt: START, now: T('2026-07-16T17:00:00Z'), providerConfigured: false, hasRecording: false, recordingLessonId: null, recordingScanStatus: null });
    expect(all.map((v) => v.act)).toEqual([...LIVE_ACTS]);
    for (const v of all) { expect(v.refusals).not.toContain('REASON_REQUIRED'); expect(v.refusals).not.toContain('ATTENDANCE_REQUIRED'); expect(v.refusals).not.toContain('MEDIA_REQUIRED'); }
    expect(all.find((v) => v.act === 'attendance')?.allowed).toBe(true); expect(all.find((v) => v.act === 'recording')?.allowed).toBe(true);
    expect(all.find((v) => v.act === 'to_lesson')?.refusals).toEqual(['RECORDING_REQUIRED']);
    expect(isLiveAct('end')).toBe(true); expect(isLiveAct('retry')).toBe(false);
  });
});

describe('live-session.state · the honest edge', () => {
  it('scheduled → live | ended | cancelled; live → ended; nothing leaves ended or cancelled', () => {
    expect(canTransition('scheduled', 'live')).toBe(true); expect(canTransition('scheduled', 'ended')).toBe(true); expect(canTransition('scheduled', 'cancelled')).toBe(true);
    expect(canTransition('live', 'ended')).toBe(true); expect(canTransition('live', 'cancelled')).toBe(false);
    expect(canTransition('ended', 'scheduled')).toBe(false); expect(canTransition('cancelled', 'scheduled')).toBe(false); expect(canTransition('ended', 'live')).toBe(false);
    expect(isOnCalendar('scheduled')).toBe(true); expect(isOnCalendar('live')).toBe(true); expect(isOnCalendar('ended')).toBe(false); expect(isOnCalendar('cancelled')).toBe(false);
  });
  it('the entity refuses a title-less class and exposes what the row holds', () => {
    expect(() => LiveSession.schedule({ id: 's', tenantId: 't', hostUserId: 'h', courseId: 'c', title: '', scheduledAt: START, durationMins: 60, capacity: null, joinUrl: null, clashAccepted: false, remind: true })).toThrow();
    const s = LiveSession.schedule({ id: 's', tenantId: 't', hostUserId: 'h', courseId: 'c', title: 'x', scheduledAt: START, durationMins: 60, capacity: null, joinUrl: null, clashAccepted: false, remind: true });
    expect(s.toJSON()).toMatchObject({ status: 'scheduled', courseId: 'c', attendanceCount: null, recordingLessonId: null });
    expect(s.pullEvents().map((e) => e.type)).toEqual(['education.live_scheduled']);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
/* THE WORDS: seed 0007's reminder templates rendered against the variables the job emits (6d-7's guard, applied) */
/* --------------------------------------------------------------------------------------------------------- */
const SEED = path.join(__dirname, '../../../../../../db/seeds/core/0007_notification_events_templates.sql');
const MIGRATION = path.join(__dirname, '../../../../../../db/migrations/0172_live_class.sql');

describe('education.live_reminder · the notice exists, in three languages, and every token has a value', () => {
  const seed = fs.readFileSync(SEED, 'utf8');
  const rows = seed.split('\n').filter((l) => /^\s*\('education\.live_reminder','(push|inapp)','(gu|hi|en)'/.test(l));
  /** The payload `remindTick` writes — the same keys, built the same way (`noticeDayText`, the DB's HH:MM). */
  const payload = { v: 1, sessionId: 's1', kind: 'day', recipientUserIds: ['u1'], title: 'Mastitis: spot it early', day: noticeDayText('2026-07-16'), time: '20:30' };

  it('six templates: push + inapp × gu · hi · en, and the event is catalogued by 0172 and mapped to the job\'s outbox type', () => {
    expect(rows).toHaveLength(6);
    const langs = rows.map((l) => /^\s*\('education\.live_reminder','(push|inapp)','(gu|hi|en)'/.exec(l)!.slice(1, 3).join('/')).sort();
    expect(langs).toEqual(['inapp/en', 'inapp/gu', 'inapp/hi', 'push/en', 'push/gu', 'push/hi']);
    expect(fs.readFileSync(MIGRATION, 'utf8')).toMatch(/INSERT INTO notification_events[\s\S]*'education\.live_reminder'/);
    const entry = NOTIFICATION_EVENT_MAP.find((e) => e.outboxType === LIVE_REMINDER_EVENT);
    expect(entry).toEqual({ outboxType: 'education.live_reminder', eventCode: 'education.live_reminder', recipientKeys: ['recipientUserIds'] });
    expect(payload.recipientUserIds.length).toBeGreaterThan(0);
  });
  it('every token in every body has a value in the payload, no body is blank, no English enum rides into a vernacular body, every required variable is used', () => {
    const declared = seed.split('\n').filter((l) => /^\s*\('education\.live_reminder',\s*'(title|day|time)'/.test(l));
    expect(declared).toHaveLength(3);
    for (const line of rows) {
      const m = /^\s*\('education\.live_reminder','(push|inapp)','(gu|hi|en)',NULL,'((?:[^']|'')*)','((?:[^']|'')*)'/.exec(line)!;
      expect(m).not.toBeNull();
      const body = m[4].replace(/''/g, "'"); const subject = m[3].replace(/''/g, "'");
      const tokens = [...(subject + body).matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)].map((t) => t[1]);
      for (const tok of tokens) expect(Object.keys(payload)).toContain(tok);
      for (const req of ['title', 'day', 'time']) expect(tokens).toContain(req);
      const rendered = NotificationTemplate.rehydrate({ id: 'x', eventCode: 'education.live_reminder', channel: m[1] as NotifChannel, languageCode: m[2], tenantId: null, subject, body, providerTemplateRef: null, isActive: true, versionId: 'v1', versionNo: 1 }).render(payload);
      expect(rendered.body).not.toMatch(/\{\{|\}\}/); expect(rendered.body).toContain('16/07'); expect(rendered.body).toContain('20:30'); expect(rendered.subject).toContain('Mastitis: spot it early');
      expect(rendered.body).not.toMatch(/\b(day|hour|soon|scheduled)\b/);   // the kind is not a token, and no enum leaks
      expect(rendered.body).not.toMatch(/https?:\/\//);                    // no link in the copy
    }
  });
});
