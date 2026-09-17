// apps/web-tenant/src/features/live/classes.ts · PURE helpers for the live class — PC-56 TENANT-7c.
//
// Two canon screens and two chains over one row: **W414** (the live schedule — *"Schedule, host, and let the recording
// carry the lesson forward"*), **W415** (the host view), **W2671–W2674** (the live FORM: *New class · Schedule anyway*)
// and **W2675–W2677** (the live MUTATE: *End class · Retry*). The API computes every verdict and every review; this file
// turns them into hrefs, keys and states, and holds the rulings the pages rely on:
//
//   • THIS PLATFORM HAS NO VIDEO PROVIDER. A class is SCHEDULED here (an instant in the cooperative's own timezone —
//     the API resolves it, this console never builds a Date from digits), HELD on the join link the host pasted, marked
//     ENDED by the host, its ATTENDANCE recorded as a number, its RECORDING attached and published as a lesson by an act.
//     *"Go live"* (`start`) is offered as the API's verdict, which in production is `PROVIDER_NOT_CONFIGURED` — printed
//     by name, never hidden.
//   • REFUSED BY NAME, because nothing on this platform performs them: W415's live attendee counter, the question queue
//     with voice transcripts, *Slow mode*, the co-host, *Low-bandwidth mode*, *Connection dropped · Rejoin*; W2675's
//     *Retry*; W414's *"Auto-record"* (a recording is a file the host attaches — the platform records nothing); W414's
//     *"shared platform calendar"* clash (the clash checked is the HOST's own classes in THIS cooperative — no calendar
//     crosses tenants) and its *"20:00–21:30 hint band … 3× the attendance"* (attendance is a number the host writes
//     down after the class; no series of them exists to average, and a hint that quoted one would be a hint that lied).
//   • NO ARITHMETIC THIS FILE INVENTS beyond integer counts: `registered / capacity` is two numbers the API sent.
import type { LiveAct, LiveActVerdict, LiveBox, LiveClassListItem, LiveClassView, LessonMediaFacts } from '@krishalaya/sdk-js';

/* --------------------------------------------------------------------------------------------------------- */
/* ROUTES                                                                                                    */
/* --------------------------------------------------------------------------------------------------------- */

export const LIVE_PATH = '/live';
export function liveHref(): string { return LIVE_PATH; }
export function liveClassHref(id: string): string { return `${LIVE_PATH}/${encodeURIComponent(id)}`; }
export const LIVE_FORM_PATH = `${LIVE_PATH}/new`;
/** The live FORM chain: a new class (optionally for a course), or `?class=` for an edit. */
export function newClassHref(courseId?: string | null): string { return courseId ? `${LIVE_FORM_PATH}?courseId=${encodeURIComponent(courseId)}` : LIVE_FORM_PATH; }
export function editClassHref(id: string): string { return `${LIVE_FORM_PATH}?class=${encodeURIComponent(id)}`; }
export function liveActPath(id: string): string { return `${liveClassHref(id)}/act`; }
/** The live MUTATE chain's confirm step — the reason travels in the URL until it is written. */
export function liveActHref(id: string, act: LiveAct): string { return `${liveActPath(id)}?step=confirm&act=${act}`; }

/* --------------------------------------------------------------------------------------------------------- */
/* W414 · THE SCHEDULE                                                                                       */
/* --------------------------------------------------------------------------------------------------------- */

export const LIVE_BOX_VALUES: readonly LiveBox[] = ['upcoming', 'past', 'mine', 'all'];
export const LIVE_STATUS_VALUES = ['scheduled', 'live', 'ended', 'cancelled'] as const;
export function liveBox(raw: string | null | undefined): LiveBox { return (LIVE_BOX_VALUES as readonly string[]).includes(raw ?? '') ? (raw as LiveBox) : 'upcoming'; }
export function liveStatusFilter(raw: string | null | undefined): string | undefined { return (LIVE_STATUS_VALUES as readonly string[]).includes(raw ?? '') ? raw! : undefined; }
export function liveStatusKey(status: string | undefined): string { return `live.status.${status ?? 'scheduled'}`; }
export function liveBoxKey(box: LiveBox): string { return `live.box.${box}`; }

/** The filters as a GET form: every filter survives a page turn, and a changed filter resets the cursor (6a's rule). */
export function scheduleHref(q: { box?: string; courseId?: string; status?: string; cursor?: string | null }): string {
  const sp = new URLSearchParams();
  if (q.box && q.box !== 'upcoming') sp.set('box', q.box);
  if (q.courseId) sp.set('courseId', q.courseId);
  if (q.status) sp.set('status', q.status);
  if (q.cursor) sp.set('cursor', q.cursor);
  const s = sp.toString();
  return s.length ? `${LIVE_PATH}?${s}` : LIVE_PATH;
}

/** W414's "When": the wall-clock the API resolved in the cooperative's zone — digits, never a Date this console built. */
export function whenText(x: Pick<LiveClassListItem, 'localDate' | 'localTime'>): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(x.localDate);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${x.localTime}` : `${x.localDate} ${x.localTime}`;
}
/** W414's "Capacity" column: `342 / 500`, or the registered count alone when the room is unlimited. */
export function capacityText(registered: number, capacity: number | null): { text: string; unlimited: boolean } {
  return capacity === null ? { text: String(registered), unlimited: true } : { text: `${registered} / ${capacity}`, unlimited: false };
}
/** W414's last column, per row: the class has become a lesson, has a recording, or neither. */
export type RowTail = 'lesson' | 'recording' | 'none';
export function rowTail(s: Pick<LiveClassListItem['session'], 'recordingLessonId' | 'recordingMediaId'>): RowTail {
  if (s.recordingLessonId) return 'lesson';
  if (s.recordingMediaId) return 'recording';
  return 'none';
}
export function rowTailKey(t: RowTail): string { return `live.tail.${t}`; }

/* --------------------------------------------------------------------------------------------------------- */
/* W415 · THE HOST DESK                                                                                      */
/* --------------------------------------------------------------------------------------------------------- */

export const LIVE_ACT_VALUES: readonly LiveAct[] = ['start', 'end', 'cancel', 'attendance', 'recording', 'to_lesson'];
export function liveVerdictFor(acts: readonly LiveActVerdict[], act: LiveAct): LiveActVerdict | null { return acts.find((v) => v.act === act) ?? null; }
export function liveActLabelKey(act: LiveAct): string { return `live.act.${act}`; }
export function liveActDoneKey(act: LiveAct): string { return `live.done.${act}`; }
/** The acts a host desk offers as buttons: the ones allowed, and the ones refused WITH their first reason printed. */
export function desktopActs(acts: readonly LiveActVerdict[]): Array<{ act: LiveAct; allowed: boolean; why: string | null }> {
  return LIVE_ACT_VALUES.map((act) => {
    const v = liveVerdictFor(acts, act);
    // `REASON_REQUIRED` is the confirm step's question, not a reason to hide the button.
    const refusals = (v?.refusals ?? []).filter((r) => r !== 'REASON_REQUIRED');
    return { act, allowed: v !== null && refusals.length === 0, why: refusals[0] ?? null };
  });
}
/** Acts whose only refusal is the row's stage are not offered at all — a cancelled class has no "End class" button. */
export function offeredActs(acts: readonly LiveActVerdict[]): Array<{ act: LiveAct; allowed: boolean; why: string | null }> {
  return desktopActs(acts).filter((a) => a.allowed || a.why !== 'ILLEGAL_FROM_STATUS');
}

export type JoinState = 'no_link' | 'host' | 'before' | 'open' | 'after' | 'not_registered' | 'cancelled';
/** What the join-link panel says to THIS caller. The API decided visibility; this names the reason the way a person hears it. */
export function joinState(v: Pick<LiveClassView, 'session' | 'joinVisible' | 'privileged' | 'registeredSelf' | 'window'>, now: Date): JoinState {
  if (v.session.status === 'cancelled') return 'cancelled';
  if (v.privileged) return v.session.joinUrl ? 'host' : 'no_link';
  if (!v.registeredSelf) return 'not_registered';
  if (v.joinVisible) return 'open';
  const t = now.getTime();
  if (t < new Date(v.window.opensAt).getTime()) return 'before';
  if (t > new Date(v.window.closesAt).getTime()) return 'after';
  return 'no_link';
}
export function joinStateKey(s: JoinState): string { return `live.join.${s}`; }

export type RecordingState = 'none' | 'pending' | 'clean' | 'infected' | 'failed' | 'lesson';
/** W414's "recorded → lesson 7", honestly: the recording is a file with a SCAN state, or already a lesson. */
export function recordingState(v: Pick<LiveClassView, 'recording' | 'recordingLesson'>): RecordingState {
  if (v.recordingLesson) return 'lesson';
  if (!v.recording) return 'none';
  const s = v.recording.scanStatus;
  return s === 'clean' || s === 'infected' || s === 'failed' ? s : 'pending';
}
export function recordingStateKey(s: RecordingState): string { return `live.recording.${s}`; }
export function recordingKindText(m: LessonMediaFacts | null): string | null { return m ? `${m.kind} · ${m.mimeType} · ${m.bytes} B` : null; }
export function reminderKindKey(kind: string): string { return `live.reminder.${kind}`; }
/** W415's "Attendees 342 of 500", as the host RECORDED it — or nothing, honestly, until they do. */
export function attendanceText(v: Pick<LiveClassView, 'session' | 'registered'>): { recorded: string | null; registered: number; capacity: number | null } {
  return { recorded: v.session.attendanceCount === null ? null : String(v.session.attendanceCount), registered: v.registered, capacity: v.session.capacity };
}

/** Everything W414/W415 draw that this platform does not perform — printed by name, never as a control. */
export const REFUSED_BY_NAME = ['stream', 'viewers', 'questions', 'slowMode', 'coHost', 'lowBandwidth', 'rejoin', 'autoRecord', 'sharedCalendar', 'hintBand', 'retry'] as const;
export function refusedKey(name: (typeof REFUSED_BY_NAME)[number]): string { return `live.refused.${name}`; }

/* --------------------------------------------------------------------------------------------------------- */
/* THE CHAINS                                                                                                */
/* --------------------------------------------------------------------------------------------------------- */

export const LIVE_FORM = 'live';
export const LIVE_FIELDS = ['courseId', 'title', 'date', 'time', 'durationMins', 'capacity', 'joinUrl', 'remind', 'clashAccepted'] as const;
export const LIVE_MUTATE_FIELDS = ['act', 'reason', 'count', 'mediaId'] as const;
/** Which extra question the confirm step asks, per act. */
export function actExtra(act: LiveAct): 'count' | 'mediaId' | null { return act === 'attendance' ? 'count' : act === 'recording' ? 'mediaId' : null; }
/** The confirm button needs the verdict, the reason — and the act's own extra when it has one. */
export function extraPresent(act: LiveAct, values: Record<string, string | undefined>): boolean {
  const e = actExtra(act);
  return e === null || ((values[e] ?? '').trim().length > 0);
}
export function liveFormDoneKey(isEdit: boolean): string { return isEdit ? 'form.live.doneEdit' : 'form.live.done'; }
/** Where a chain's *Back to the screen* goes: the class when there is one, the schedule otherwise. */
export function backFromChain(id: string | null): string { return id ? liveClassHref(id) : liveHref(); }
