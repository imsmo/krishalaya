// modules/education/domain/live-clock.ts · PC-56 TENANT-7c · the class as an INTERVAL, the join WINDOW, the CLASH, and the
// wall-clock a host types.
//
// A class scheduled *"Thu 16 Jul, 20:30"* is 20:30 where the COOPERATIVE is. The host types a date (`2026-07-16`) and a
// time (`20:30`); this file validates the shape and nothing more, because the conversion of that wall-clock into an
// instant is done IN SQL against `tenants.country_code → countries.timezone` (6c-1's resolution, `LiveClassRepository.
// resolveStart`) — never in the Node process's zone, which is the defect class TENANT-6b-1 spent a wave removing. What
// this file owns is the arithmetic that needs no zone: an interval from an instant and a duration, whether two
// intervals overlap, whether an instant lies inside a window, and which reminder offsets are due. Integer minutes and
// epoch milliseconds throughout; nothing here is a float.
export const MIN_DURATION_MINS = 5;
export const MAX_DURATION_MINS = 480;
export const DEFAULT_DURATION_MINS = 60;
export const MAX_CAPACITY = 100_000;
/** W414: *"Capacity above 500 needs tenant approval"* — enforced as the desk's key, not a metered budget. */
export const CAPACITY_NEEDS_DESK_ABOVE = 500;
/** A registered member may open the join link this many minutes before the start, and until this many after the end. */
export const JOIN_OPENS_BEFORE_MINS = 15;
export const JOIN_CLOSES_AFTER_MINS = 30;
/** `start` (the provider edge) is refused more than this many minutes before the start. */
export const START_EARLY_MINS = 15;
export const MAX_ATTENDANCE = 1_000_000;

const MS = 60_000;

/** `YYYY-MM-DD` as a real calendar day (no 31 Feb). Null otherwise. */
export function parseDateOnly(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return s;
}

/** `HH:MM` (24-hour) or `H:MM` → `HH:MM`. Null otherwise. */
export function parseWallTime(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/** Whole minutes in [MIN, MAX]. Null for anything else (a fraction, a sign, `0`, `1000`). */
export function parseDurationMins(raw: string | null | undefined): number | null {
  const s = (raw ?? '').trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= MIN_DURATION_MINS && n <= MAX_DURATION_MINS ? n : null;
}

/** A whole number in [1, MAX_CAPACITY]. Null for anything else. */
export function parseCapacity(raw: string | null | undefined): number | null {
  const s = (raw ?? '').trim();
  if (!/^\d{1,6}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= MAX_CAPACITY ? n : null;
}

/** A whole number in [0, MAX_ATTENDANCE]. Null for anything else. */
export function parseAttendance(raw: string | null | undefined): number | null {
  const s = (raw ?? '').trim();
  if (!/^\d{1,7}$/.test(s)) return null;
  const n = Number(s);
  return n <= MAX_ATTENDANCE ? n : null;
}

/** The join link the host pastes: https only, no whitespace, a host part. Null otherwise. */
export function parseJoinUrl(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (s.length === 0 || s.length > 500 || /\s/.test(s)) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname.length === 0) return null;
  return s;
}

export interface Interval { startsAt: Date; endsAt: Date }

/** The class as an interval: [start, start + duration). */
export function intervalOf(startsAt: Date, durationMins: number): Interval {
  return { startsAt, endsAt: new Date(startsAt.getTime() + durationMins * MS) };
}

/** Two half-open intervals overlap when each starts before the other ends. Touching (one ends as the other starts) is not a clash. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

export interface OtherClass { id: string; title: string; startsAt: Date; durationMins: number }

/** W414's clash: the same host's OTHER classes still on the calendar that overlap this one. Never the class itself. */
export function clashesWith(mine: Interval, others: readonly OtherClass[], selfId: string | null): OtherClass[] {
  return others.filter((o) => o.id !== selfId && overlaps(mine, intervalOf(o.startsAt, o.durationMins)));
}

export interface JoinWindow { opensAt: Date; closesAt: Date }

/** When a registered member may open the join link: a little before the start, until a little after the end. */
export function joinWindowOf(i: Interval): JoinWindow {
  return { opensAt: new Date(i.startsAt.getTime() - JOIN_OPENS_BEFORE_MINS * MS), closesAt: new Date(i.endsAt.getTime() + JOIN_CLOSES_AFTER_MINS * MS) };
}
export function isWithin(now: Date, w: JoinWindow): boolean {
  const t = now.getTime();
  return t >= w.opensAt.getTime() && t <= w.closesAt.getTime();
}
/** `start` may not be taken more than START_EARLY_MINS before the start. */
export function startTooEarly(now: Date, startsAt: Date): boolean {
  return now.getTime() < startsAt.getTime() - START_EARLY_MINS * MS;
}
/** `end` from `scheduled` (held elsewhere) needs the start to have passed. */
export function beforeStart(now: Date, startsAt: Date): boolean { return now.getTime() < startsAt.getTime(); }

/* --------------------------------------------------------------------------------------------------------- */
/* REMINDERS — W414 "Reminder cadence: 1 day, 1 hour, 10 min before"                                          */
/* --------------------------------------------------------------------------------------------------------- */

export const REMINDER_KINDS = ['day', 'hour', 'soon'] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

/** The tenant's offsets (minutes before the start), largest first, each named by its place. Up to three; junk dropped. */
export function reminderOffsets(setting: unknown): Array<{ kind: ReminderKind; mins: number }> {
  const raw = Array.isArray(setting) ? setting : [];
  const mins = [...new Set(raw.map((x) => (typeof x === 'string' ? Number(x) : x)).filter((x): x is number => Number.isInteger(x) && x > 0 && x <= 60 * 24 * 30))].sort((a, b) => b - a).slice(0, 3);
  return mins.map((m, i) => ({ kind: REMINDER_KINDS[i], mins: m }));
}

/**
 * Which reminders are DUE for a class at `now`: the offset has been reached (start − offset ≤ now) and the class has
 * not started yet. Nothing is due for a class that has begun: a "10 minutes before" notice sent after the fact is
 * noise, and a class rescheduled forward simply becomes due again for the kinds it has not yet sent.
 */
export function remindersDue(now: Date, startsAt: Date, offsets: ReadonlyArray<{ kind: ReminderKind; mins: number }>, sent: ReadonlySet<string>): ReminderKind[] {
  const t = now.getTime(); const s = startsAt.getTime();
  if (t >= s) return [];
  return offsets.filter((o) => !sent.has(o.kind) && s - o.mins * MS <= t).map((o) => o.kind);
}

/** The digits a notice carries: `DD/MM` and `HH:MM` from a wall-clock the DATABASE already resolved in the tenant's zone. */
export function noticeDayText(localDate: string): string { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate); return m ? `${m[3]}/${m[2]}` : localDate; }
