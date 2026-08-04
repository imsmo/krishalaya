// apps/mobile/src/features/ambassador/visits.ts · PURE derivations over the ambassador's OWN visit log (164).
// No React/native (SDK type is `import type` → erased) → unit-tested. Buckets the caller's real logged visits by
// day and counts this-month activity for the summary header.
//
// §13 (NOT faked): AmbassadorVisit exposes {visitedUserId, purpose, notes, lat, lng, regionId, visitedAt} — the
// visitedUserId/regionId are opaque ids (no farmer NAME, no village NAME), there is NO planned/scheduled-visit
// state, NO per-visit commission amount, and NO distance-travelled aggregate. So the screen shows real logged
// visits (time + purpose + notes) grouped by day, a this-month count and a distinct-region count — never a
// fabricated "Anil Kumar · BORSAD · +₹25" planned row or a made-up "142 km travelled".
import type { AmbassadorVisit } from '@krishalaya/sdk-js';

export type VisitDay = 'today' | 'yesterday' | 'earlier';

/** Local Y-M-D key for an ISO timestamp, or null when absent/unparseable. */
function dayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Which day bucket a visit falls in relative to `now`. null when the timestamp is missing/bad. */
export function visitDayBucket(visitedAt: string | null | undefined, now: Date = new Date()): VisitDay | null {
  const k = dayKey(visitedAt);
  if (!k) return null;
  const today = dayKey(now.toISOString());
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
  const yesterday = dayKey(y.toISOString());
  if (k === today) return 'today';
  if (k === yesterday) return 'yesterday';
  return 'earlier';
}

export interface VisitGroups { today: AmbassadorVisit[]; yesterday: AmbassadorVisit[]; earlier: AmbassadorVisit[] }
/** Group visits into today / yesterday / earlier, each sorted newest-first. Pure (does not mutate input). */
export function groupVisitsByDay(visits: readonly AmbassadorVisit[] | null | undefined, now: Date = new Date()): VisitGroups {
  const g: VisitGroups = { today: [], yesterday: [], earlier: [] };
  const sorted = [...(visits ?? [])].sort((a, b) => (b.visitedAt ?? '').localeCompare(a.visitedAt ?? ''));
  for (const v of sorted) {
    const b = visitDayBucket(v.visitedAt, now);
    if (b) g[b].push(v);
  }
  return g;
}

/** "YYYY-MM" bucket for month comparisons. */
function monthKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${d.getMonth()}`;
}

/** Count of visits logged in the calendar month of `now`. */
export function visitsThisMonth(visits: readonly AmbassadorVisit[] | null | undefined, now: Date = new Date()): number {
  const key = monthKey(now.toISOString());
  return (visits ?? []).filter((v) => monthKey(v.visitedAt) === key).length;
}

/** Count of distinct regions visited in the month of `now` (regionId is an opaque id — a count, never a name). */
export function distinctRegionsThisMonth(visits: readonly AmbassadorVisit[] | null | undefined, now: Date = new Date()): number {
  const key = monthKey(now.toISOString());
  const set = new Set<string>();
  for (const v of visits ?? []) {
    if (monthKey(v.visitedAt) !== key) continue;
    if (v.regionId) set.add(v.regionId);
  }
  return set.size;
}
