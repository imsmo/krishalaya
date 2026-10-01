// modules/communication/domain/quiet-window.ts · PC-56 TENANT-8b (F-4, F-5, F-6) · the quiet window as arithmetic.
//
// THREE QUESTIONS, ONE PLACE, NO I/O:
//   1. WHICH WINDOW applies to this member tonight? Their own row, read in their own zone — sanitised (F-6); else the
//      COOPERATIVE's default (`notification.quiet_hours_default`, 21:00–06:00, 0012's own column defaults) in the
//      cooperative's zone (`countries.timezone`, 7c's resolution) — F-5: before this wave a member with no row was never
//      quiet, because the schema's defaults only apply to a row that exists and none is created at signup.
//   2. ARE WE INSIDE IT, now, in that zone? (overnight windows wrap midnight; starts = ends is "off").
//   3. WHEN DOES IT END? — the instant a HELD row may be released (F-4: quiet-hours items were dropped; they are held
//      now, `held_until` is this answer, and the release job sends them at or after it).
// And for the review: the window's length, whether it crosses midnight, and its next occurrence as two instants.
//
// Wall-clock → instant conversion is done against the zone's own offset AT that instant (two passes, so a DST change
// between the guess and the answer is absorbed). Minutes are integers; nothing here is a float.
import { sanitiseTimezone } from './timezone';

export interface QuietWindow { starts: string; ends: string; timezone: string }
export type WindowSource = 'own' | 'tenant_default';
export interface EffectiveWindow extends QuietWindow {
  source: WindowSource;
  /** The member's row named a zone this process cannot use; `timezone` is the substitute (logged by the fan-out). */
  sanitised: boolean;
  requestedZone: string | null;
}

const MINUTES_PER_DAY = 1440;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/** `HH:MM[:SS]` → minutes of day, or null when it is not a time. Seconds are ignored (the window is minute-grained). */
export function toMinutes(hhmm: string | null | undefined): number | null {
  const m = HHMM.exec((hhmm ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** `HH:MM` for minutes of day (0–1439). */
export function fromMinutes(mins: number): string {
  const n = ((mins % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

interface LocalParts { y: number; m: number; d: number; minutes: number }

/** The wall clock in `zone` at `instant`. `zone` must be usable (callers pass a sanitised one). */
export function localParts(instant: Date, zone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return { y: get('year'), m: get('month'), d: get('day'), minutes: (get('hour') % 24) * 60 + get('minute') };
}

/** Local wall-clock minutes-of-day in `zone`. */
export function minutesOfDayInTz(now: Date, zone: string): number { return localParts(now, zone).minutes; }

/** The zone's offset from UTC at `instant`, in whole minutes (Asia/Kolkata → 330). */
export function zoneOffsetMinutes(instant: Date, zone: string): number {
  const p = localParts(instant, zone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, Math.floor(p.minutes / 60), p.minutes % 60);
  const floored = Math.floor(instant.getTime() / 60000) * 60000;
  return Math.round((asUtc - floored) / 60000);
}

/** The instant at which the wall clock in `zone` reads `y-m-d` + `minutes`. Two passes absorb a DST change. */
export function wallToInstant(y: number, m: number, d: number, minutes: number, zone: string): Date {
  const guess = Date.UTC(y, m - 1, d, 0, 0) + minutes * 60000;
  const first = guess - zoneOffsetMinutes(new Date(guess), zone) * 60000;
  const second = guess - zoneOffsetMinutes(new Date(first), zone) * 60000;
  return new Date(second);
}

/** The calendar day after `y-m-d` (pure calendar arithmetic, no zone). */
function nextDay(y: number, m: number, d: number, by = 1): { y: number; m: number; d: number } {
  const t = new Date(Date.UTC(y, m - 1, d + by));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** Minutes the window lasts; 0 when starts = ends (the window is off). Overnight windows wrap. */
export function windowLengthMinutes(starts: string, ends: string): number {
  const s = toMinutes(starts); const e = toMinutes(ends);
  if (s === null || e === null) return 0;
  return ((e - s) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** Does the window run past midnight (21:00 → 06:00)? */
export function crossesMidnight(starts: string, ends: string): boolean {
  const s = toMinutes(starts); const e = toMinutes(ends);
  return s !== null && e !== null && s > e;
}

/** Is `now` inside the window, read in its own zone? starts = ends → never. */
export function isWithinWindow(now: Date, w: QuietWindow): boolean {
  const s = toMinutes(w.starts); const e = toMinutes(w.ends);
  if (s === null || e === null || s === e) return false;
  const cur = minutesOfDayInTz(now, w.timezone);
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}

/**
 * When does the window `now` sits in END? Null when `now` is not inside it. This is a held row's `held_until`.
 *
 * The end is the next time the wall clock reads `ends` AFTER now — today's date in the zone if that is still ahead
 * (03:00 inside 21:00→06:00 ends at 06:00 the same local morning), otherwise tomorrow's (23:00 ends at 06:00 the next
 * local morning).
 */
export function windowEndAfter(now: Date, w: QuietWindow): Date | null {
  if (!isWithinWindow(now, w)) return null;
  const e = toMinutes(w.ends)!;
  const p = localParts(now, w.timezone);
  const today = wallToInstant(p.y, p.m, p.d, e, w.timezone);
  if (today.getTime() > now.getTime()) return today;
  const n = nextDay(p.y, p.m, p.d);
  return wallToInstant(n.y, n.m, n.d, e, w.timezone);
}

/**
 * The window's current or next occurrence, as two instants — the review's "quiet from 21:00 tonight until 06:00
 * tomorrow" and the bell's "held until". Null when the window is off or malformed.
 */
export function nextOccurrence(now: Date, w: QuietWindow): { start: Date; end: Date; current: boolean } | null {
  const s = toMinutes(w.starts); const len = windowLengthMinutes(w.starts, w.ends);
  if (s === null || len === 0) return null;
  const p = localParts(now, w.timezone);
  if (isWithinWindow(now, w)) {
    const end = windowEndAfter(now, w)!;
    // It began on today's local date if the start is not ahead of us, else yesterday's (03:00 inside 21:00→06:00).
    const startDay = p.minutes >= s ? { y: p.y, m: p.m, d: p.d } : nextDay(p.y, p.m, p.d, -1);
    return { start: wallToInstant(startDay.y, startDay.m, startDay.d, s, w.timezone), end, current: true };
  }
  let startDay = { y: p.y, m: p.m, d: p.d };
  let start = wallToInstant(p.y, p.m, p.d, s, w.timezone);
  if (start.getTime() <= now.getTime()) {
    startDay = nextDay(p.y, p.m, p.d);
    start = wallToInstant(startDay.y, startDay.m, startDay.d, s, w.timezone);
  }
  const endDay = crossesMidnight(w.starts, w.ends) ? nextDay(startDay.y, startDay.m, startDay.d) : startDay;
  return { start, end: wallToInstant(endDay.y, endDay.m, endDay.d, toMinutes(w.ends)!, w.timezone), current: false };
}

/**
 * WHICH WINDOW APPLIES (F-5, F-6). The member's own row — read in their zone if this process can use it, else in the
 * cooperative's (sanitised, reported) — and, for a member with no row, the cooperative's default window in the
 * cooperative's zone. Null only when there is no own row AND no tenant (a platform-level notice has no cooperative to
 * inherit a window from) or the default is malformed.
 */
export function effectiveWindow(
  own: QuietWindow | null,
  tenantDefault: { starts: string; ends: string } | null,
  tenantZone: string | null,
): EffectiveWindow | null {
  if (own && toMinutes(own.starts) !== null && toMinutes(own.ends) !== null) {
    const z = sanitiseTimezone(own.timezone, tenantZone);
    return { starts: own.starts, ends: own.ends, timezone: z.zone, source: 'own', sanitised: z.sanitised, requestedZone: z.requested };
  }
  if (!tenantDefault || toMinutes(tenantDefault.starts) === null || toMinutes(tenantDefault.ends) === null) return null;
  const z = sanitiseTimezone(tenantZone, null);
  return { starts: tenantDefault.starts, ends: tenantDefault.ends, timezone: z.zone, source: 'tenant_default', sanitised: false, requestedZone: null };
}

/** Read a tenant setting's json value as a window, or null when it is not one (a corrupt setting is "no default"). */
export function parseWindowSetting(v: unknown): { starts: string; ends: string } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const s = typeof o.starts === 'string' ? o.starts : null; const e = typeof o.ends === 'string' ? o.ends : null;
  return s !== null && e !== null && toMinutes(s) !== null && toMinutes(e) !== null ? { starts: s, ends: e } : null;
}
