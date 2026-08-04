// apps/mobile/src/features/labour/browse-jobs.ts · PURE filter/sort/tag logic for the worker "Find Jobs"
// marketplace (screen 30). No React / no SDK I/O (SDK types are `import type` → erased) → unit-tested. These only
// shape/order what the server already returned; the SERVER stays the authority on which bookings are open, the
// wage floor, and eligibility. Money is compared as BigInt minor units (Law 2) — never floated.
import type { LabourBooking } from '@krishalaya/sdk-js';

/** A quick-filter chip. `all` clears; `today`/`week` bucket by start date; `group`/`women` use booking flags;
 * `skill:<id>` filters by the booking's task skill (§13 — distance/amenity filters from the design aren't here
 * because the booking read carries no geo or "water/lunch provided" fields). */
export type JobFilter = 'all' | 'today' | 'week' | 'group' | 'women';
export const JOB_FILTERS: readonly JobFilter[] = ['all', 'today', 'week', 'group', 'women'];
export type JobSort = 'soonest' | 'wage';

function big(v: string): bigint { try { return BigInt(v); } catch { return 0n; } }
function startMs(b: LabourBooking): number { const t = Date.parse(b.startDate); return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t; }
function dayKey(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }

/** Does a booking match the active filter? A `skill:<id>` string filters by task skill. Pure. */
export function matchesFilter(b: LabourBooking, filter: string, nowMs: number = Date.now()): boolean {
  if (filter === 'all') return true;
  if (filter === 'today') return startMs(b) !== Number.POSITIVE_INFINITY && dayKey(startMs(b)) === dayKey(nowMs);
  if (filter === 'week') { const s = startMs(b); return s >= nowMs - 86400000 && s <= nowMs + 7 * 86400000; }
  if (filter === 'group') return (b.workersNeeded ?? 1) > 1;
  if (filter === 'women') return b.womenOnly === true;
  if (filter.startsWith('skill:')) return b.taskSkillId === filter.slice('skill:'.length);
  return true;
}

/** Apply a filter, returning a new array (order preserved). Pure. */
export function filterJobs(items: readonly LabourBooking[], filter: string, nowMs?: number): LabourBooking[] {
  return (items ?? []).filter((b) => matchesFilter(b, filter, nowMs));
}

/** Sort by soonest start date (default) or highest wage (BigInt-safe, descending). Returns a NEW array. Pure. */
export function sortJobs(items: readonly LabourBooking[], sort: JobSort): LabourBooking[] {
  const arr = [...(items ?? [])];
  if (sort === 'wage') {
    arr.sort((a, b) => { const d = big(b.wageOfferedMinor) - big(a.wageOfferedMinor); return d > 0n ? 1 : d < 0n ? -1 : 0; });
  } else {
    arr.sort((a, b) => startMs(a) - startMs(b));
  }
  return arr;
}

/** Real, booking-backed tags for a job card. The design shows amenity tags (Water/Lunch provided, Skilled work),
 * but those fields aren't on the booking read (§13) — these are the badges we can actually prove: a group job
 * (workersNeeded > 1), women-only, and a wage above the statutory minimum (both snapshotted on the booking). Pure. */
export function jobTags(b: LabourBooking): Array<'group' | 'women' | 'aboveMin'> {
  const tags: Array<'group' | 'women' | 'aboveMin'> = [];
  if ((b.workersNeeded ?? 1) > 1) tags.push('group');
  if (b.womenOnly === true) tags.push('women');
  if (big(b.wageOfferedMinor) > big(b.minWageMinor)) tags.push('aboveMin');
  return tags;
}

/** The distinct task-skill ids present in a job list, in first-seen order — powers the dynamic skill filter chips
 * (each labelled via lookups). Pure. */
export function presentSkillIds(items: readonly LabourBooking[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const b of items ?? []) { if (b.taskSkillId && !seen.has(b.taskSkillId)) { seen.add(b.taskSkillId); out.push(b.taskSkillId); } }
  return out;
}
