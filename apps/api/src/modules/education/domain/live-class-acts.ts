// modules/education/domain/live-class-acts.ts · PC-56 TENANT-7c · the acts on a class, as verdicts — the live-mutate
// chain (W2675 confirm → W2676 success → W2677 failure), whose canon names *"End class · Retry"*, and W415's host desk.
// Same shape as 7a's `course-acts.ts` and 7b's `lesson-acts.ts`: the confirm screen asks the verdict, the act RE-TAKES
// it on the locked row, and the reasons come in the order a person wants to hear them: permission → the host →
// the class's stage → what the act needs → the reason.
//
//   start        scheduled → live      the PROVIDER edge. This platform has no stream provider (`STREAM_PROVIDER_URL`
//                                      unset ⇒ noop), so in production this is refused BY NAME: `PROVIDER_NOT_CONFIGURED`.
//                                      Not more than 15 minutes early either.
//   end          scheduled|live → ended W415 *"End class"*. From `scheduled` it means "held on the join link, and over" —
//                                      refused before the start (`BEFORE_START`).
//   cancel       scheduled → cancelled  with a reason, before the class is held.
//   attendance   (ended)                W415's *"Attendees 342"* — a number the host RECORDS. Needs `count`.
//   recording    (ended)                attach the recording through core/media (a video or audio asset in THIS tenant's
//                                      bucket). Needs `mediaId`. Re-attaching replaces, until it is a lesson.
//   to_lesson    (ended, recording)     W414 *"recorded → lesson 7"*: publish the recording as a `live`-kind lesson on
//                                      the course — DELTA-047's "auto-publishes" performed by a person, with a reason.
//                                      Refused while the scan is pending (`MEDIA_NOT_CLEAN`), once done (`LESSON_EXISTS`).
//
// W2675's *"Retry"* is NOT an act: there is nothing on this platform to retry — no stream to reconnect (W415's
// *"Connection dropped … Rejoin"*), no processing job. It is refused by name on the page. W415's *"Slow mode"*,
// *"co-host"*, the question queue with voice transcripts and the low-bandwidth mode have no table and no provider; they
// are named on the page as what they are, not drawn as controls.
import { LiveStatus } from './creator.events';
import { canTransition } from './live-session.state';
import { MIN_ACT_REASON, MAX_ACT_REASON } from './course-acts';
import { beforeStart, parseAttendance, startTooEarly } from './live-clock';

export const LIVE_ACTS = ['start', 'end', 'cancel', 'attendance', 'recording', 'to_lesson'] as const;
export type LiveAct = (typeof LIVE_ACTS)[number];
export function isLiveAct(s: string): s is LiveAct { return (LIVE_ACTS as readonly string[]).includes(s); }

export const LIVE_ACT_REFUSALS = [
  'NO_PERMISSION', 'NOT_HOST', 'COURSE_ARCHIVED', 'ILLEGAL_FROM_STATUS',
  'PROVIDER_NOT_CONFIGURED', 'TOO_EARLY', 'BEFORE_START',
  'ATTENDANCE_REQUIRED', 'ATTENDANCE_INVALID',
  'MEDIA_REQUIRED', 'MEDIA_UNKNOWN', 'MEDIA_KIND_MISMATCH', 'MEDIA_NOT_CLEAN', 'RECORDING_REQUIRED', 'LESSON_EXISTS',
  'REASON_REQUIRED',
] as const;
export type LiveActRefusal = (typeof LIVE_ACT_REFUSALS)[number];

export const RECORDING_KINDS: ReadonlySet<string> = new Set(['video', 'audio']);

export interface LiveActInput {
  act: LiveAct;
  canAuthor: boolean; canPublish: boolean;
  /** The caller is the class's host (the course's instructor). The desk (`canPublish`) may act on any class. */
  isHost: boolean;
  courseStatus: string | null;
  status: LiveStatus;
  scheduledAt: Date; now: Date;
  /** `stream.providerCode !== 'noop'` — the only honest meaning of "a provider is configured". */
  providerConfigured: boolean;
  hasRecording: boolean; recordingLessonId: string | null;
  /** The media asset named for `recording` (undefined = nothing named; null = named and not in THIS tenant's bucket). */
  media: { kind: string; scanStatus: string } | null | undefined;
  /** For `to_lesson`: the ATTACHED recording's scan state (null when none). */
  recordingScanStatus: string | null;
  count: string | null | undefined;
  reason: string | null | undefined;
}
export interface LiveActVerdict { act: LiveAct; allowed: boolean; refusals: LiveActRefusal[]; to: LiveStatus | null }

const reasonUsable = (r: string | null | undefined) => { const s = (r ?? '').trim(); return s.length >= MIN_ACT_REASON && s.length <= MAX_ACT_REASON; };

export function liveActVerdict(i: LiveActInput): LiveActVerdict {
  const refusals: LiveActRefusal[] = [];
  if (!(i.canAuthor || i.canPublish)) refusals.push('NO_PERMISSION');
  if (!i.isHost && !i.canPublish) refusals.push('NOT_HOST');
  if (i.courseStatus === 'archived') refusals.push('COURSE_ARCHIVED');
  let to: LiveStatus | null = null;
  switch (i.act) {
    case 'start':
      to = 'live';
      if (!canTransition(i.status, 'live')) refusals.push('ILLEGAL_FROM_STATUS');
      if (!i.providerConfigured) refusals.push('PROVIDER_NOT_CONFIGURED');
      if (startTooEarly(i.now, i.scheduledAt)) refusals.push('TOO_EARLY');
      break;
    case 'end':
      to = 'ended';
      if (!canTransition(i.status, 'ended')) refusals.push('ILLEGAL_FROM_STATUS');
      // held elsewhere: a class cannot be over before it was due to begin
      else if (i.status === 'scheduled' && beforeStart(i.now, i.scheduledAt)) refusals.push('BEFORE_START');
      break;
    case 'cancel':
      to = 'cancelled';
      if (!canTransition(i.status, 'cancelled')) refusals.push('ILLEGAL_FROM_STATUS');
      break;
    case 'attendance': {
      if (i.status !== 'ended') refusals.push('ILLEGAL_FROM_STATUS');
      const c = (i.count ?? '').trim();
      if (c.length === 0) refusals.push('ATTENDANCE_REQUIRED');
      else if (parseAttendance(c) === null) refusals.push('ATTENDANCE_INVALID');
      break;
    }
    case 'recording':
      if (i.status !== 'ended') refusals.push('ILLEGAL_FROM_STATUS');
      if (i.recordingLessonId !== null) refusals.push('LESSON_EXISTS');
      if (i.media === undefined) refusals.push('MEDIA_REQUIRED');
      else if (i.media === null) refusals.push('MEDIA_UNKNOWN');
      else if (!RECORDING_KINDS.has(i.media.kind)) refusals.push('MEDIA_KIND_MISMATCH');
      break;
    case 'to_lesson':
      if (i.status !== 'ended') refusals.push('ILLEGAL_FROM_STATUS');
      if (!i.hasRecording) refusals.push('RECORDING_REQUIRED');
      else if (i.recordingScanStatus !== 'clean') refusals.push('MEDIA_NOT_CLEAN');
      if (i.recordingLessonId !== null) refusals.push('LESSON_EXISTS');
      break;
  }
  if (!reasonUsable(i.reason)) refusals.push('REASON_REQUIRED');
  return { act: i.act, allowed: refusals.length === 0, refusals, to };
}

/** Every act's verdict for the desk that offers buttons; the reason, the count and the file are the confirm step's questions. */
export function allLiveVerdicts(base: Omit<LiveActInput, 'act' | 'reason' | 'count' | 'media'>): LiveActVerdict[] {
  return LIVE_ACTS.map((act) => liveActVerdict({ ...base, act, reason: 'placeholder', count: '0', media: act === 'recording' ? { kind: 'video', scanStatus: 'pending' } : undefined }));
}
