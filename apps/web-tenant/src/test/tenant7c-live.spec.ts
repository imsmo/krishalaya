// apps/web-tenant/src/test/tenant7c-live.spec.ts · PC-56 TENANT-7c · the live class's console helpers, and the catalogue
// promise that every key a page can ask for exists ×3 — for every box, status, act, act refusal, join state, recording
// state, reminder kind, refused-by-name sentence, form field and every refusal code the API's reviewer can emit.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LiveActVerdict, LiveClassView } from '@krishalaya/sdk-js';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  LIVE_ACT_VALUES, LIVE_BOX_VALUES, LIVE_FIELDS, LIVE_FORM, LIVE_MUTATE_FIELDS, LIVE_STATUS_VALUES, REFUSED_BY_NAME, actExtra, attendanceText, backFromChain, capacityText, desktopActs, editClassHref,
  extraPresent, joinState, joinStateKey, liveActDoneKey, liveActHref, liveActLabelKey, liveActPath, liveBox, liveBoxKey, liveClassHref, liveFormDoneKey, liveHref, liveStatusFilter, liveStatusKey,
  liveVerdictFor, newClassHref, offeredActs, recordingKindText, recordingState, recordingStateKey, refusedKey, reminderKindKey, rowTail, rowTailKey, scheduleHref, whenText,
} from '../features/live/classes';
import { fieldLabelKey, refusalKey, readCarried, carryValues } from '../features/forms/chain';
import { mutateRefusalKey } from '../features/mutate/chain';

const three = (k: string) => { for (const [n, cat] of [['en', en], ['hi', hi], ['gu', gu]] as const) expect(cat[k as keyof typeof cat] ? `${n}` : `${n} MISSING ${k}`).toBe(n); };
const api = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../api/src/modules/education/domain', rel), 'utf8');
function apiList(file: string, constName: string): string[] {
  const src = api(file);
  const i = src.indexOf(`${constName} = [`);
  if (i < 0) throw new Error(`${constName} not in ${file}`);
  return [...src.slice(i, src.indexOf('] as const', i)).matchAll(/'([A-Za-z_]+)'/g)].map((m) => m[1]);
}
const S = (o: Partial<LiveClassView['session']> = {}): LiveClassView['session'] => ({
  id: 's', hostUserId: 'h', channelId: null, courseId: 'c', title: 'Mastitis', topicId: null, scheduledAt: '2026-07-16T15:00:00.000Z', durationMins: 90, capacity: 500, joinUrl: 'https://meet.example/x', clashAccepted: false, remind: true,
  status: 'scheduled', playbackUrl: null, recordingMediaId: null, recordingAttachedAt: null, recordingLessonId: null, startedAt: null, endedAt: null, cancelledAt: null, attendanceCount: null, attendanceRecordedAt: null, attendanceRecordedBy: null, ...o,
});
const V = (o: Partial<LiveClassView> = {}): LiveClassView => ({
  session: S(), localDate: '2026-07-16', localTime: '20:30', timezone: 'Asia/Kolkata', registered: 12, course: { id: 'c', defaultTitle: 'Buffalo', status: 'published' },
  window: { opensAt: '2026-07-16T14:45:00.000Z', closesAt: '2026-07-16T17:00:00.000Z' }, joinVisible: false, isHost: false, privileged: false, canEdit: false, registeredSelf: false, providerConfigured: false,
  acts: [], recording: null, recordingLesson: null, reminders: [], form: {}, ...o,
});
const verdict = (act: LiveActVerdict['act'], refusals: LiveActVerdict['refusals'] = []): LiveActVerdict => ({ act, allowed: refusals.length === 0, refusals, to: null });

describe('PC-56 TENANT-7c · routes and filters', () => {
  it('every canon clickable has an href; the filters survive a page turn and a changed box resets the cursor', () => {
    expect(liveHref()).toBe('/live'); expect(liveClassHref('a b')).toBe('/live/a%20b'); expect(newClassHref()).toBe('/live/new'); expect(newClassHref('c')).toBe('/live/new?courseId=c');
    expect(editClassHref('s')).toBe('/live/new?class=s'); expect(liveActPath('s')).toBe('/live/s/act'); expect(liveActHref('s', 'end')).toBe('/live/s/act?step=confirm&act=end');
    expect(scheduleHref({})).toBe('/live'); expect(scheduleHref({ box: 'upcoming' })).toBe('/live');
    expect(scheduleHref({ box: 'past', courseId: 'c', status: 'ended', cursor: 'abc' })).toBe('/live?box=past&courseId=c&status=ended&cursor=abc');
    expect(scheduleHref({ box: 'past', courseId: 'c' })).not.toContain('cursor');
    expect(backFromChain(null)).toBe('/live'); expect(backFromChain('s')).toBe('/live/s');
  });
  it('unknown boxes and statuses fall back rather than error', () => {
    expect(liveBox('past')).toBe('past'); expect(liveBox('bogus')).toBe('upcoming'); expect(liveBox(undefined)).toBe('upcoming');
    expect(liveStatusFilter('ended')).toBe('ended'); expect(liveStatusFilter('nope')).toBeUndefined(); expect(liveStatusFilter(null)).toBeUndefined();
  });
});

describe('PC-56 TENANT-7c · W414 the schedule', () => {
  it('"When" is the wall-clock the API resolved — digits, never a Date this console built', () => {
    expect(whenText({ localDate: '2026-07-16', localTime: '20:30' })).toBe('16/07/2026 20:30');
    expect(whenText({ localDate: 'odd', localTime: '20:30' })).toBe('odd 20:30');
  });
  it('capacity is two integers the API sent, or the registered count alone when unlimited', () => {
    expect(capacityText(342, 500)).toEqual({ text: '342 / 500', unlimited: false });
    expect(capacityText(0, null)).toEqual({ text: '0', unlimited: true });
  });
  it('the last column: lesson > recording > none', () => {
    expect(rowTail({ recordingLessonId: 'l', recordingMediaId: 'm' })).toBe('lesson');
    expect(rowTail({ recordingLessonId: null, recordingMediaId: 'm' })).toBe('recording');
    expect(rowTail({ recordingLessonId: null, recordingMediaId: null })).toBe('none');
  });
});

describe('PC-56 TENANT-7c · W415 the host desk', () => {
  it('the acts offered: allowed ones as buttons, refused ones with their first reason, stage-only refusals hidden, the reason never a reason to hide', () => {
    const acts = [verdict('start', ['PROVIDER_NOT_CONFIGURED']), verdict('end'), verdict('cancel', ['ILLEGAL_FROM_STATUS']), verdict('attendance', ['ILLEGAL_FROM_STATUS']), verdict('recording', ['ILLEGAL_FROM_STATUS']), verdict('to_lesson', ['ILLEGAL_FROM_STATUS', 'RECORDING_REQUIRED'])];
    expect(desktopActs(acts).map((a) => [a.act, a.allowed, a.why])).toEqual([
      ['start', false, 'PROVIDER_NOT_CONFIGURED'], ['end', true, null], ['cancel', false, 'ILLEGAL_FROM_STATUS'], ['attendance', false, 'ILLEGAL_FROM_STATUS'], ['recording', false, 'ILLEGAL_FROM_STATUS'], ['to_lesson', false, 'ILLEGAL_FROM_STATUS'],
    ]);
    expect(offeredActs(acts).map((a) => a.act)).toEqual(['start', 'end']);
    expect(desktopActs([verdict('end', ['REASON_REQUIRED'])]).find((a) => a.act === 'end')).toEqual({ act: 'end', allowed: true, why: null });
    expect(desktopActs([]).every((a) => !a.allowed && a.why === null)).toBe(true);
    expect(liveVerdictFor(acts, 'end')?.allowed).toBe(true); expect(liveVerdictFor(acts, 'start')?.allowed).toBe(false); expect(liveVerdictFor([], 'end')).toBeNull();
  });
  it('the join state names why THIS caller does or does not see the link', () => {
    const now = new Date('2026-07-16T14:00:00Z');
    expect(joinState(V({ privileged: true, isHost: true, joinVisible: true }), now)).toBe('host');
    expect(joinState(V({ privileged: true, session: S({ joinUrl: null }) }), now)).toBe('no_link');
    expect(joinState(V({ registeredSelf: false }), now)).toBe('not_registered');
    expect(joinState(V({ registeredSelf: true, joinVisible: false }), now)).toBe('before');
    expect(joinState(V({ registeredSelf: true, joinVisible: true }), new Date('2026-07-16T15:00:00Z'))).toBe('open');
    expect(joinState(V({ registeredSelf: true, joinVisible: false }), new Date('2026-07-16T18:00:00Z'))).toBe('after');
    expect(joinState(V({ registeredSelf: true, joinVisible: false, session: S({ joinUrl: null }) }), new Date('2026-07-16T15:00:00Z'))).toBe('no_link');
    expect(joinState(V({ privileged: true, session: S({ status: 'cancelled' }) }), now)).toBe('cancelled');
  });
  it('the recording state is the file\'s SCAN state, or the lesson it became', () => {
    expect(recordingState(V())).toBe('none');
    for (const s of ['pending', 'clean', 'infected', 'failed'] as const) expect(recordingState(V({ recording: { id: 'm', kind: 'video', scanStatus: s, mimeType: 'video/mp4', bytes: '1', durationSecs: null } }))).toBe(s);
    expect(recordingState(V({ recording: { id: 'm', kind: 'video', scanStatus: 'weird', mimeType: 'video/mp4', bytes: '1', durationSecs: null } }))).toBe('pending');
    expect(recordingState(V({ recording: { id: 'm', kind: 'video', scanStatus: 'clean', mimeType: 'video/mp4', bytes: '1', durationSecs: null }, recordingLesson: { id: 'l', defaultTitle: 'x', position: '1·7' } }))).toBe('lesson');
    expect(recordingKindText(null)).toBeNull(); expect(recordingKindText({ id: 'm', kind: 'audio', scanStatus: 'clean', mimeType: 'audio/mpeg', bytes: '12', durationSecs: null })).toBe('audio · audio/mpeg · 12 B');
  });
  it('attendance is what the host recorded — nothing until they do', () => {
    expect(attendanceText(V())).toEqual({ recorded: null, registered: 12, capacity: 500 });
    expect(attendanceText(V({ session: S({ attendanceCount: 342, capacity: null }) }))).toEqual({ recorded: '342', registered: 12, capacity: null });
    expect(attendanceText(V({ session: S({ attendanceCount: 0 }) })).recorded).toBe('0');
  });
});

describe('PC-56 TENANT-7c · the chains', () => {
  it('the mutate chain asks the act\'s own extra question, and waits for it', () => {
    expect(actExtra('attendance')).toBe('count'); expect(actExtra('recording')).toBe('mediaId'); for (const a of ['start', 'end', 'cancel', 'to_lesson'] as const) expect(actExtra(a)).toBeNull();
    expect(extraPresent('attendance', { count: '342' })).toBe(true); expect(extraPresent('attendance', { count: ' ' })).toBe(false); expect(extraPresent('attendance', {})).toBe(false);
    expect(extraPresent('recording', { mediaId: 'm' })).toBe(true); expect(extraPresent('end', {})).toBe(true);
    const q = carryValues('confirm', { act: 'attendance', reason: 'counted', count: '342', mediaId: '' }).query;
    expect(readCarried(Object.fromEntries(new URLSearchParams(q)), LIVE_MUTATE_FIELDS)).toEqual({ act: 'attendance', reason: 'counted', count: '342' });
  });
  it('the form fields are the API\'s, in the API\'s order; the success keys', () => {
    expect([...LIVE_FIELDS]).toEqual(apiList('live-class-review.ts', 'LIVE_FORM_FIELDS'));
    expect(liveFormDoneKey(false)).toBe('form.live.done'); expect(liveFormDoneKey(true)).toBe('form.live.doneEdit');
  });
});

describe('PC-56 TENANT-7c · the catalogue promise ×3', () => {
  it('every box, status, act, done, refused-by-name, join, recording, reminder, tail key exists in en · hi · gu', () => {
    for (const b of LIVE_BOX_VALUES) three(liveBoxKey(b));
    for (const s of LIVE_STATUS_VALUES) three(liveStatusKey(s));
    for (const a of LIVE_ACT_VALUES) { three(liveActLabelKey(a)); three(liveActDoneKey(a)); three(`mutate.live.note.${a}`); }
    for (const n of REFUSED_BY_NAME) three(refusedKey(n));
    for (const j of ['no_link', 'host', 'before', 'open', 'after', 'not_registered', 'cancelled'] as const) three(joinStateKey(j));
    for (const r of ['none', 'pending', 'clean', 'infected', 'failed', 'lesson'] as const) three(recordingStateKey(r));
    for (const k of ['day', 'hour', 'soon']) three(reminderKindKey(k));
    for (const t of ['lesson', 'recording', 'none'] as const) three(rowTailKey(t));
    for (const k of ['live.host.register.CLASS_FULL', 'live.host.register.CLASS_NOT_OPEN', 'live.host.register.failed', 'live.state.notFound', 'mutate.live.need.count', 'mutate.live.need.mediaId', 'nav.live', 'live.declared', 'live.capacityRule', 'live.reminderRule']) three(k);
  });
  it('every refusal code the API\'s reviewer and verdict can emit has a sentence ×3, and every form field a label — including the rows the form never asked', () => {
    for (const code of apiList('live-class-review.ts', 'LIVE_REVIEW_REFUSALS')) three(refusalKey(LIVE_FORM, code));
    for (const code of ['TOO_LONG', 'VALUE_REJECTED']) three(refusalKey(LIVE_FORM, code));
    for (const code of apiList('live-class-acts.ts', 'LIVE_ACT_REFUSALS')) three(mutateRefusalKey('live', code));
    for (const f of [...LIVE_FIELDS, 'startsAt', 'endsAt', 'clash']) three(fieldLabelKey(LIVE_FORM, f));
    expect(apiList('live-class-acts.ts', 'LIVE_ACTS')).toEqual([...LIVE_ACT_VALUES]);
  });
  it('the PC-26b live keys are gone with their page (a dead key is a key that will one day render its own name)', () => {
    for (const k of ['live.sessions', 'live.sessionsEmpty', 'live.act.start', 'live.ok.start', 'live.error.live_when', 'live.chStatus.pending', 'live.channelChoose']) {
      expect(k === 'live.act.start' ? true : (en as Record<string, string>)[k] === undefined).toBe(true);
    }
    expect((en as Record<string, string>)['live.act.start']).toBe('Go live');   // re-homed, not the PC-26b button over a channel
  });
});
