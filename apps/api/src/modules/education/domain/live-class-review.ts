// modules/education/domain/live-class-review.ts · PC-56 TENANT-7c · the live form's review step — W2672 (review), W2671
// (form-error) — computed from the facts the writer uses, never an echo of what was typed (7a's rule, 6d-4's shape).
//
// The canon's live module names two actions on this chain: *"New class · Schedule anyway"*. Both are ONE form over ONE
// row: a class is scheduled, and *Schedule anyway* is the same form with the clash ACKNOWLEDGED — a checkbox the
// review turns into a stored fact (`clash_accepted`), so the host's choice is on the row and in the audit trail. The
// canon calls the clash a *"soft warning"*; here it is a refusal the host can lift by name, because a review that
// says "ready" over a clash the host never saw is the defect this file exists to prevent.
//
// WHAT THE REVIEW SHOWS THAT THE FORM NEVER ASKED: the INSTANT the class starts — the wall-clock the host typed, in the
// cooperative's timezone, and the UTC instant the row will hold (resolved by the database, never by this process); the
// END of the class; the OTHER class of this host's that overlaps it, by title and time. And what the canon's W414
// draws that this review does NOT compute: *"another tenant's class on the shared platform calendar"* — there is no
// shared calendar across tenants on this platform (RLS is the wall, by design), so the clash is against the host's OWN
// classes in THIS cooperative, and the screen says so.
import { ReviewDiffRow, ReviewField, ReviewRefusal, ReviewResult, WRITER_REFUSALS, WriterIssue, field, reviewResult, trimOrNull, writerRefusals } from '../../../shared/form-review';
import { LiveStatus } from './creator.events';
import {
  CAPACITY_NEEDS_DESK_ABOVE, DEFAULT_DURATION_MINS, OtherClass, clashesWith, intervalOf, parseCapacity, parseDateOnly, parseDurationMins, parseJoinUrl, parseWallTime,
} from './live-clock';

export const LIVE_REVIEW_REFUSALS = [
  'NO_AUTHOR', 'NOT_OWNER', 'COURSE_REQUIRED', 'COURSE_NOT_FOUND', 'COURSE_ARCHIVED', 'HOST_UNKNOWN',
  'CLASS_NOT_FOUND', 'CLASS_NOT_SCHEDULED',
  'TITLE_REQUIRED', 'DATE_REQUIRED', 'DATE_INVALID', 'TIME_REQUIRED', 'TIME_INVALID', 'ZONE_UNKNOWN', 'STARTS_IN_PAST',
  'DURATION_INVALID', 'CAPACITY_INVALID', 'CAPACITY_NEEDS_DESK', 'JOIN_URL_INVALID', 'HOST_CLASH',
  ...WRITER_REFUSALS,
] as const;
export type LiveReviewRefusal = (typeof LIVE_REVIEW_REFUSALS)[number];

/** Every field the chain carries — one list, shared by the reviewer, the DTO and the console's form. */
export const LIVE_FORM_FIELDS = ['courseId', 'title', 'date', 'time', 'durationMins', 'capacity', 'joinUrl', 'remind', 'clashAccepted'] as const;
export type LiveFormField = (typeof LIVE_FORM_FIELDS)[number];

export interface CurrentClass {
  id: string; status: LiveStatus; courseId: string | null; hostUserId: string; title: string; scheduledAt: Date; durationMins: number;
  capacity: number | null; joinUrl: string | null; clashAccepted: boolean; remind: boolean;
  /** The start as a wall-clock in the cooperative's zone, resolved by the database. */
  localDate: string; localTime: string;
}
/** The database's answer for the typed wall-clock: the instant, and the zone it used. */
export interface ResolvedStart { startsAt: Date; timezone: string }

export interface LiveReviewInput {
  canAuthor: boolean; canPublish: boolean;
  /** The caller is the user behind the course's instructor row. */
  isOwner: boolean;
  /** The course named: undefined = nothing typed; null = typed and no such course of ours; else its status and its instructor's user (null = no instructor row). */
  course: { status: string; instructorUserId: string | null } | null | undefined;
  /** Edit mode: the row as it stands (undefined = create; null = an id was named and no such class is ours). */
  current?: CurrentClass | null;
  entered: Partial<Record<LiveFormField, string | null | undefined>>;
  /** The typed date+time as an instant in the tenant's zone: undefined = not asked (the wall-clock did not parse); null = asked and the tenant has no zone. */
  resolved: ResolvedStart | null | undefined;
  /** The host's OTHER classes still on the calendar (the class being edited may be among them; it is excluded by id). */
  others: readonly OtherClass[];
  now: Date;
  writerIssues?: readonly WriterIssue[];
}

export interface LiveStored {
  courseId: string; hostUserId: string; title: string; scheduledAt: Date; durationMins: number; capacity: number | null; joinUrl: string | null; clashAccepted: boolean; remind: boolean;
}

const truthy = (s: string | null | undefined): boolean => ['1', 'true', 'on', 'yes'].includes((s ?? '').trim().toLowerCase());
const two = (n: number) => String(n).padStart(2, '0');
/** `HH:MM` + minutes → `HH:MM` on the same or the next day, for the review's END row. */
export function addMinutesToWall(time: string, mins: number): { time: string; nextDay: boolean } {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + mins;
  return { time: `${two(Math.floor(total / 60) % 24)}:${two(total % 60)}`, nextDay: total >= 24 * 60 };
}

export function reviewLiveClass(i: LiveReviewInput): ReviewResult {
  const refusals: ReviewRefusal[] = [];
  const isEdit = i.current !== undefined;
  if (!i.canAuthor && !i.canPublish) refusals.push({ field: null, code: 'NO_AUTHOR' });
  if (isEdit) {
    if (!i.current) refusals.push({ field: null, code: 'CLASS_NOT_FOUND' });
    else if (i.current.status !== 'scheduled') refusals.push({ field: null, code: 'CLASS_NOT_SCHEDULED' });
  }

  // THE COURSE — the class belongs to one, and its instructor is the host. An edit keeps the course.
  const courseTyped = isEdit ? (i.current?.courseId ?? null) : trimOrNull(i.entered.courseId);
  if (isEdit && !i.current) { /* no class, so no course to judge — CLASS_NOT_FOUND above is the whole answer */ }
  else if (courseTyped === null) refusals.push({ field: 'courseId', code: 'COURSE_REQUIRED' });
  else if (!i.course) refusals.push({ field: 'courseId', code: 'COURSE_NOT_FOUND' });
  else {
    if (!i.isOwner && !i.canPublish) refusals.push({ field: null, code: 'NOT_OWNER' });
    if (i.course.status === 'archived') refusals.push({ field: 'courseId', code: 'COURSE_ARCHIVED' });
    if (i.course.instructorUserId === null) refusals.push({ field: 'courseId', code: 'HOST_UNKNOWN' });
  }

  const title = trimOrNull(i.entered.title);
  if (title === null) refusals.push({ field: 'title', code: 'TITLE_REQUIRED' });

  // THE WALL-CLOCK, as typed; THE INSTANT, as the database resolved it in the cooperative's zone.
  const dateTyped = trimOrNull(i.entered.date); const timeTyped = trimOrNull(i.entered.time);
  const date = dateTyped === null ? null : parseDateOnly(dateTyped);
  const time = timeTyped === null ? null : parseWallTime(timeTyped);
  if (dateTyped === null) refusals.push({ field: 'date', code: 'DATE_REQUIRED' }); else if (date === null) refusals.push({ field: 'date', code: 'DATE_INVALID' });
  if (timeTyped === null) refusals.push({ field: 'time', code: 'TIME_REQUIRED' }); else if (time === null) refusals.push({ field: 'time', code: 'TIME_INVALID' });
  let startsAt: Date | null = null; let zone: string | null = null;
  if (date !== null && time !== null) {
    if (i.resolved === null || i.resolved === undefined) refusals.push({ field: 'time', code: 'ZONE_UNKNOWN' });
    else {
      startsAt = i.resolved.startsAt; zone = i.resolved.timezone;
      const moved = !isEdit || !i.current || i.current.scheduledAt.getTime() !== startsAt.getTime();
      if (moved && startsAt.getTime() < i.now.getTime()) refusals.push({ field: 'time', code: 'STARTS_IN_PAST' });
    }
  }

  const durTyped = trimOrNull(i.entered.durationMins);
  const durationMins = durTyped === null ? DEFAULT_DURATION_MINS : parseDurationMins(durTyped);
  if (durationMins === null) refusals.push({ field: 'durationMins', code: 'DURATION_INVALID' });

  const capTyped = trimOrNull(i.entered.capacity);
  let capacity: number | null = null;
  if (capTyped !== null) {
    capacity = parseCapacity(capTyped);
    if (capacity === null) refusals.push({ field: 'capacity', code: 'CAPACITY_INVALID' });
    else if (capacity > CAPACITY_NEEDS_DESK_ABOVE && !i.canPublish) refusals.push({ field: 'capacity', code: 'CAPACITY_NEEDS_DESK' });
  }

  const urlTyped = trimOrNull(i.entered.joinUrl);
  const joinUrl = urlTyped === null ? null : parseJoinUrl(urlTyped);
  if (urlTyped !== null && joinUrl === null) refusals.push({ field: 'joinUrl', code: 'JOIN_URL_INVALID' });

  const remind = truthy(i.entered.remind);
  const clashAccepted = truthy(i.entered.clashAccepted);

  // THE CLASH — against the host's OWN classes on this cooperative's calendar, excluding the class being edited.
  let clashes: OtherClass[] = [];
  if (startsAt !== null && durationMins !== null) {
    clashes = clashesWith(intervalOf(startsAt, durationMins), i.others, i.current?.id ?? null);
    if (clashes.length > 0 && !clashAccepted) refusals.push({ field: 'clashAccepted', code: 'HOST_CLASH' });
  }

  const end = time !== null && durationMins !== null ? addMinutesToWall(time, durationMins) : null;
  const fields: ReviewField[] = [
    field('courseId', i.entered.courseId ?? (isEdit ? i.current?.courseId ?? null : null), i.course && courseTyped ? courseTyped : null),
    field('title', i.entered.title ?? null, title),
    field('date', i.entered.date ?? null, date),
    field('time', i.entered.time ?? null, time),
    // NEVER TYPED, ALWAYS SHOWN: the instant, in the cooperative's zone and as the row will hold it.
    field('startsAt', null, startsAt !== null && zone !== null ? `${date} ${time} ${zone} · ${startsAt.toISOString()}` : null),
    field('durationMins', i.entered.durationMins ?? null, durationMins === null ? null : String(durationMins)),
    field('endsAt', null, end === null ? null : `${end.time}${end.nextDay ? ' +1' : ''}`),
    field('capacity', i.entered.capacity ?? null, capacity === null ? null : String(capacity)),
    field('joinUrl', i.entered.joinUrl ?? null, joinUrl),
    field('remind', i.entered.remind ?? null, remind ? 'on' : 'off'),
    field('clashAccepted', i.entered.clashAccepted ?? null, clashes.length === 0 ? null : (clashAccepted ? 'accepted' : null)),
    field('clash', null, clashes.length === 0 ? null : clashes.map((c) => `${c.title} · ${c.startsAt.toISOString()} · ${c.durationMins} min`).join('\n')),
  ];
  refusals.push(...writerRefusals(i.writerIssues ?? [], fields.map((f) => f.name), refusals));

  let diff: ReviewDiffRow[] | null = null;
  if (isEdit && i.current) {
    diff = [];
    const c = i.current;
    const push = (f: string, before: string | null, after: string | null) => { if (before !== after) diff!.push({ field: f, before, after }); };
    push('title', c.title, title);
    push('startsAt', c.scheduledAt.toISOString(), startsAt === null ? null : startsAt.toISOString());
    push('durationMins', String(c.durationMins), durationMins === null ? null : String(durationMins));
    push('capacity', c.capacity === null ? null : String(c.capacity), capacity === null ? null : String(capacity));
    push('joinUrl', c.joinUrl, joinUrl);
    push('remind', c.remind ? 'on' : 'off', remind ? 'on' : 'off');
    push('clashAccepted', c.clashAccepted ? 'accepted' : null, clashes.length > 0 && clashAccepted ? 'accepted' : null);
  }
  return reviewResult('live_session', fields, refusals, diff);
}

/** The row the writer receives when `ready` — the same digits the review showed. */
export function storedLiveClass(i: LiveReviewInput): LiveStored | null {
  const r = reviewLiveClass(i);
  if (!r.ready || !i.resolved || !i.course || i.course.instructorUserId === null) return null;
  const isEdit = i.current !== undefined;
  const durTyped = trimOrNull(i.entered.durationMins);
  const capTyped = trimOrNull(i.entered.capacity);
  const urlTyped = trimOrNull(i.entered.joinUrl);
  const durationMins = durTyped === null ? DEFAULT_DURATION_MINS : (parseDurationMins(durTyped) as number);
  const clashes = clashesWith(intervalOf(i.resolved.startsAt, durationMins), i.others, i.current?.id ?? null);
  return {
    courseId: (isEdit ? (i.current as CurrentClass).courseId : trimOrNull(i.entered.courseId)) as string,
    hostUserId: i.course.instructorUserId,
    title: trimOrNull(i.entered.title) as string,
    scheduledAt: i.resolved.startsAt,
    durationMins,
    capacity: capTyped === null ? null : parseCapacity(capTyped),
    joinUrl: urlTyped === null ? null : parseJoinUrl(urlTyped),
    // accepted only where there was a clash to accept — a stale checkbox does not survive a move to a free slot
    clashAccepted: clashes.length > 0 && truthy(i.entered.clashAccepted),
    remind: truthy(i.entered.remind),
  };
}

/** The form's own view of a stored class — the values the EDIT step opens with. */
export function liveFormValues(c: CurrentClass): Record<LiveFormField, string> {
  return {
    courseId: c.courseId ?? '', title: c.title, date: c.localDate, time: c.localTime, durationMins: String(c.durationMins),
    capacity: c.capacity === null ? '' : String(c.capacity), joinUrl: c.joinUrl ?? '', remind: c.remind ? '1' : '', clashAccepted: c.clashAccepted ? '1' : '',
  };
}
