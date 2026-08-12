// apps/admin-api/src/modules/demand-map/domain/demand-map.ts · W108 pure rules (PC-56 ADMIN-SWEEP-c3). No I/O.
//
// DELTA-027'S OWN WARNINGS ARE THE DESIGN, SO THEY ARE ENFORCED HERE AS STRUCTURE, NOT AS PROSE:
//   • "search ≠ requirement" — blending them manufactures demand. This vocabulary has NO operation that adds
//     sources together: demand value is open-requirement value ONLY, order flow is its own figure, and search
//     interest is a type whose only inhabitant is 'not_recorded' (no code path on the platform persists a search
//     query — the search service increments a metrics counter and returns). A number here would be invented.
//   • district-level aggregates only — the read groups at admin_regions level 2 and nothing below; no per-buyer
//     figure exists in any shape this module can return.
//   • the k-anonymity floor before any file leaves the platform — a district × product cell with fewer than
//     K distinct buyers is close enough to ONE buyer that exporting it exports that buyer's demand. exportFloor()
//     drops those cells from the file and REPORTS the drop; a silent floor reads as complete coverage.

/** Below five distinct buyers, an aggregate is a person wearing a number. The floor applies to FILES (the screen
 *  is god-mode, already audited per-request); cells below it are marked on screen and dropped from exports. */
export const K_ANONYMITY_FLOOR = 5;

export const EXPORT_REASON_MIN = 10; // one floor with Farmer 360's export — a reason is an audit row, not a ritual

export class DemandRuleError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/* ------------------------------------------------------------------ the three sources, kept apart */

/** What the "search interest" column may say today. There is no measured variant on purpose: nothing records a
 *  search query, so a figure would be worse than none (the portal-sync 'unmeasured' discipline, applied again). */
export type SearchInterest = { kind: 'not_recorded'; reason: string };

export function searchInterest(): SearchInterest {
  return {
    kind: 'not_recorded',
    reason: 'no code path persists a search query — the search service emits a metrics counter and nothing else, so search interest has never been recorded; recording it is backend work (DELTA-027), and a figure invented from nothing would manufacture demand',
  };
}

/** The gap verdict for one district × product cell. Values arrive as decimal strings (bigint minor units). */
export type GapVerdict =
  | { kind: 'gap'; pct: number }        // demand exceeds listed supply — the growth team's call list
  | { kind: 'covered' }                 // listed supply meets or exceeds demand
  | { kind: 'unvalued' };               // no rupee figure exists on either side — a count is not a value

export function gapVerdict(demandMinor: string | null, supplyMinor: string | null): GapVerdict {
  const d = demandMinor === null ? null : BigInt(demandMinor);
  const s = supplyMinor === null ? 0n : BigInt(supplyMinor);
  if (d === null || d <= 0n) return { kind: 'unvalued' };
  if (s >= d) return { kind: 'covered' };
  return { kind: 'gap', pct: Number(((d - s) * 100n) / d) };
}

/* ------------------------------------------------------------------ the k-anonymity floor */

export interface FloorableCell { buyersN: number }

export function belowFloor(c: FloorableCell): boolean {
  return c.buyersN < K_ANONYMITY_FLOOR;
}

/** Split cells for export: kept rows go in the file, suppressed rows become a COUNT that travels with the file.
 *  The floor is applied before the digest is computed — the receipt hashes what actually left. */
export function exportFloor<T extends FloorableCell>(cells: readonly T[]): { kept: T[]; suppressed: number } {
  const kept = cells.filter((c) => !belowFloor(c));
  return { kept, suppressed: cells.length - kept.length };
}

/* ------------------------------------------------------------------ the week window */

function isoDow(d: Date): number {
  return d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // Monday = 1 … Sunday = 7
}

function mondayOfIsoWeek(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4)); // Jan 4 is always in ISO week 1
  return new Date(jan4.getTime() + ((week - 1) * 7 - (isoDow(jan4) - 1)) * 86_400_000);
}

export function isoWeekOf(d: Date): { year: number; week: number } {
  // ISO week = the week containing this date's Thursday.
  const thu = new Date(d.getTime() + (4 - isoDow(d)) * 86_400_000);
  const year = thu.getUTCFullYear();
  const week = Math.floor((thu.getTime() - mondayOfIsoWeek(year, 1).getTime()) / (7 * 86_400_000)) + 1;
  return { year, week };
}

export interface WeekWindow { isoWeek: string; start: Date; end: Date } // [start, end) — Monday to next Monday

/** Parse '2026-W28' (or default to the week containing `now`). A week number the year does not have is refused —
 *  '2026-W53' would otherwise silently read as a week of 2027, and a window that lies about its year is a window
 *  that lies about its data. */
export function weekWindow(week: string | undefined, now: Date): WeekWindow {
  let year: number, w: number;
  if (week === undefined) {
    ({ year, week: w } = isoWeekOf(now));
  } else {
    const m = /^(\d{4})-W(\d{2})$/.exec(week);
    if (!m) throw new DemandRuleError('DEMAND_BAD_WEEK', 'week must look like 2026-W28');
    year = Number(m[1]); w = Number(m[2]);
    const weeksInYear = isoWeekOf(new Date(Date.UTC(year, 11, 28))).week; // Dec 28 is always in the last ISO week
    if (w < 1 || w > weeksInYear) {
      throw new DemandRuleError('DEMAND_BAD_WEEK', `${year} has ${weeksInYear} ISO weeks; W${String(w).padStart(2, '0')} does not exist`);
    }
  }
  const start = mondayOfIsoWeek(year, w);
  return { isoWeek: `${year}-W${String(w).padStart(2, '0')}`, start, end: new Date(start.getTime() + 7 * 86_400_000) };
}

/* ------------------------------------------------------------------ the export reason */

export function assertExportReason(reason: unknown): string {
  const r = typeof reason === 'string' ? reason.trim() : '';
  if (r.length < EXPORT_REASON_MIN) {
    throw new DemandRuleError('DEMAND_EXPORT_REASON', `an export reason of at least ${EXPORT_REASON_MIN} characters is required — it lands in the audit row`);
  }
  return r;
}

/* ------------------------------------------------------------------ the bases (printed beside every figure) */

/** Why each number is what it is. These travel WITH the figures so no column can outlive its definition — and the
 *  two clocks are named apart: demand and supply are AS OF NOW (no history table exists for either), while order
 *  flow is the selected week (the only source with a timeline to window). */
export const BASES = {
  demand: "open or partially matched buyer requirements, valued at the buyer's own stated budget (ceiling, or floor when only a floor was given) — as of now; requirements without any budget are counted, never valued",
  supply: 'Σ price × available quantity over published listings — stock as listed right now, not a harvest forecast',
  orderFlow: 'orders created in the selected week, all statuses except cancelled',
  district: 'district = admin_regions level 2, resolved from the delivery pincode (requirements) or the delivery address (orders) or the listing region (supply); rows that resolve to no district are counted, never guessed',
} as const;
