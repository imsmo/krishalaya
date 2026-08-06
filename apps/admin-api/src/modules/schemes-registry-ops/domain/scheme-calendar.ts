// apps/admin-api/src/modules/schemes-registry-ops/domain/scheme-calendar.ts · pure calendar arithmetic for W073.
//
// `schemes.application_window` stores 'MM-DD' with NO YEAR, which is right for the data (PMFBY's kharif window is
// 01 Jun – 31 Jul every year, not in 2026 only) and awkward for arithmetic: "how many days until it closes" has no
// answer until a year is chosen. Everything here takes an explicit reference instant so the choice is visible and
// testable, never a hidden `new Date()` inside a formatter.

export interface Window { opens: string; closes: string; season?: string }

const MMDD = /^(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Parse 'MM-DD' into month/day, or null when it is not that shape. */
export function parseMmDd(v: unknown): { month: number; day: number } | null {
  if (typeof v !== 'string') return null;
  const m = MMDD.exec(v);
  if (!m) return null;
  const month = Number(m[1]); const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

/** Does this month/day exist in this year? 'MM-DD' can name a date that some years do not have.
 *
 *  '02-29' is the whole reason this function exists. A window closing on 29 February exists in 2028 and does not
 *  exist in 2027, and the tempting shortcut — `Date.UTC(2027, 1, 29)` — silently rolls forward to 1 March, telling a
 *  farmer the door is open one day longer than it is. On a scheme deadline that is not a rounding error; it is a
 *  missed application. So an impossible date is reported as impossible.
 */
export function existsInYear(month: number, day: number, year: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export type CloseState =
  | { kind: 'closes_in'; days: number; onYear: number }
  | { kind: 'closes_today'; onYear: number }
  | { kind: 'no_window' }
  | { kind: 'unparseable' }
  /** The close date does not exist in the year it would next fall in — e.g. 02-29 in a non-leap year. */
  | { kind: 'impossible_date'; month: number; day: number; onYear: number };

/** How long until a window closes, measured from `now`.
 *
 *  Returns a STATE, not a number, because every one of the four non-numeric outcomes needs to render differently and
 *  a function returning `number | null` collapses them into one indistinguishable "no answer". A scheme with no
 *  window (pm_kisan, kcc — always open) is not the same fact as a scheme whose window we failed to parse, and the
 *  second one is a bug somebody must fix.
 */
export function closeState(window: unknown, now: Date): CloseState {
  if (window === null || window === undefined || typeof window !== 'object') return { kind: 'no_window' };
  const w = window as Record<string, unknown>;
  if (w.closes === undefined && w.opens === undefined) return { kind: 'no_window' };
  const c = parseMmDd(w.closes);
  if (!c) return { kind: 'unparseable' };

  const nowY = now.getUTCFullYear();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  // The window closes on the next occurrence of this month/day — this year if it has not passed, otherwise next.
  let year = nowY;
  if (existsInYear(c.month, c.day, year) && Date.UTC(year, c.month - 1, c.day) < todayUtc) year = nowY + 1;
  if (!existsInYear(c.month, c.day, year)) return { kind: 'impossible_date', month: c.month, day: c.day, onYear: year };

  const days = Math.round((Date.UTC(year, c.month - 1, c.day) - todayUtc) / DAY_MS);
  return days === 0 ? { kind: 'closes_today', onYear: year } : { kind: 'closes_in', days, onYear: year };
}

/** True when a window wraps the year end (opens after it closes, e.g. rabi: opens 10-01, closes 03-31). Not an
 *  error — it is how a rabi window is expressed, and the calendar SQL already handles it. */
export function wrapsYear(window: unknown): boolean {
  if (!window || typeof window !== 'object') return false;
  const w = window as Record<string, unknown>;
  const o = parseMmDd(w.opens); const c = parseMmDd(w.closes);
  if (!o || !c) return false;
  return o.month * 100 + o.day > c.month * 100 + c.day;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE NUDGE QUEUE — WHAT W073 SHOWS AND WHAT THE PLATFORM CAN ACTUALLY DO                                      */
/* ------------------------------------------------------------------------------------------------------------ */
/** W073's lower panel is a schedule of D−14 / D−7 / D−2 "window closing" nudges with per-channel fan-out
 *  (push + SMS + IVR + WhatsApp), an "eligible not-applied" audience size, and a scheduled send time.
 *
 *  NONE OF THAT EXISTS, and each missing piece is a different kind of missing:
 *    • THE SCHEDULE has no job. `SCHEDULED_JOB_REGISTRY` in apps/api holds no scheme-window job of any kind, so no
 *      D−14 nudge has ever been queued or ever will be until one is written.
 *    • THE AUDIENCE has no source. "Eligible not-applied" requires evaluating every scheme's `eligibility_rules`
 *      against every farmer profile in every tenant and subtracting those who already applied. The eligibility
 *      evaluator exists (`Scheme.evaluate`) but it runs for ONE farmer against ONE scheme on request; there is no
 *      sweep, no materialised audience, and no store for one.
 *    • THE CHANNELS have no providers. IVR outbound and voice do not exist anywhere in the monorepo, and SMS
 *      templates cannot be delivered without DLT ids, which the platform does not have (standing debt since 0101).
 *
 *  So the calendar reports the DERIVABLE fact — a window closing in N days, which is real and computed above — and
 *  says the nudge queue is not built. It does not render three greyed rows implying a scheduler exists, and it does
 *  not estimate an audience: a number like "est. 9,000" on a screen an operator plans outreach from is worse than
 *  no number, because they will plan against it.
 */
export const NUDGE_QUEUE_GAP = {
  available: false as const,
  reason: 'not_built' as const,
  missing: ['scheduler', 'eligible_not_applied_audience', 'ivr_provider', 'dlt_registration'] as const,
};

/** Windows closing within `withinDays`, newest deadline first — the only half of W073's lower panel that is real. */
export function closingSoon<T extends { applicationWindow: unknown }>(
  rows: T[], now: Date, withinDays: number,
): Array<T & { closeState: CloseState }> {
  return rows
    .map((r) => ({ ...r, closeState: closeState(r.applicationWindow, now) }))
    .filter((r) => (r.closeState.kind === 'closes_in' && r.closeState.days <= withinDays) || r.closeState.kind === 'closes_today')
    .sort((a, b) => {
      const da = a.closeState.kind === 'closes_in' ? a.closeState.days : 0;
      const db = b.closeState.kind === 'closes_in' ? b.closeState.days : 0;
      return da - db;
    });
}
