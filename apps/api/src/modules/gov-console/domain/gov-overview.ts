// modules/gov-console/domain/gov-overview.ts · PC-56 GOV-1b · GOV1-B5 — THE OVERVIEW'S SHAPE (pure). GOV-1 Q1-A and Q3-A (lead-applied
// 2026-11-10 under the founder's instruction "please choose recommended option … think as you are product owner"; his to reopen).
//
// The repository counts in SQL over the WHOLE set of applications to the authority's schemes (every shard, drafts and deleted rows excluded);
// this function only arranges those counts: every scheme the authority runs (with zeros), every counted status (with zeros), the totals, and
// the two queues only a person clears — `clarification_needed` and `appealed` (both exist in `application_status`, 0011) — each with its
// count and the oldest row's whole days since its last change. WHAT IS NEVER HERE: an application id, an organisation, an applicant, a form
// field, a district, a percentage, a rate, a target, a money figure or a credit (Q1-A: `kv_gov` holds no grant on `dbt_transfers`, so the
// axis cannot count credits — none is shown). The window is ALL TIME: no financial-year or season claim.
import type { GovOverviewCell } from '../repositories/gov-console.repository';

/** The statuses counted (every `application_status` except `draft`, which is not yet submitted). */
export const OVERVIEW_STATUSES = Object.freeze(['submitted', 'under_verification', 'clarification_needed', 'approved', 'rejected', 'disbursed', 'closed', 'appealed'] as const);
export type OverviewStatus = (typeof OVERVIEW_STATUSES)[number];
/** The queues that only a person clears. */
export const OVERVIEW_QUEUES = Object.freeze(['clarification_needed', 'appealed'] as const);

export interface GovOverview {
  /** What the counts cover: every application ever submitted to the authority's schemes on this platform; drafts not counted. */
  window: { kind: 'all_time'; draftsCounted: false };
  computedAt: string;
  schemes: { count: number };
  byScheme: Array<{ scheme: { id: string; code: string; name: string }; total: number; byStatus: Record<OverviewStatus, number> }>;
  totals: { total: number; byStatus: Record<OverviewStatus, number> };
  queues: Array<{ status: (typeof OVERVIEW_QUEUES)[number]; count: number; oldestDays: number | null }>;
}

const zeros = (): Record<OverviewStatus, number> => Object.fromEntries(OVERVIEW_STATUSES.map((s) => [s, 0])) as Record<OverviewStatus, number>;
const counted = (s: string): s is OverviewStatus => (OVERVIEW_STATUSES as readonly string[]).includes(s);

export function shapeOverview(schemes: ReadonlyArray<{ id: string; code: string; name: string }>, cells: readonly GovOverviewCell[], computedAt: string): GovOverview {
  const byScheme = schemes.map((scheme) => ({ scheme: { id: scheme.id, code: scheme.code, name: scheme.name }, total: 0, byStatus: zeros() }));
  const totals = { total: 0, byStatus: zeros() };
  const queues = OVERVIEW_QUEUES.map((status) => ({ status, count: 0, oldestDays: null as number | null }));
  for (const c of cells) {
    if (!counted(c.status)) continue;
    const row = byScheme.find((r) => r.scheme.id === c.schemeId);
    if (!row) continue;   // a cell for a scheme this authority does not run cannot arrive (the axis); never counted if it did
    row.byStatus[c.status] += c.count; row.total += c.count;
    totals.byStatus[c.status] += c.count; totals.total += c.count;
    const q = queues.find((x) => x.status === c.status);
    if (q && c.count > 0) { q.count += c.count; if (c.oldestDays !== null) q.oldestDays = Math.max(q.oldestDays ?? 0, c.oldestDays); }
  }
  return { window: { kind: 'all_time', draftsCounted: false }, computedAt, schemes: { count: schemes.length }, byScheme, totals, queues };
}
