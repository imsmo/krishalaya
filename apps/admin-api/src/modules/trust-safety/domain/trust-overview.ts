// apps/admin-api/src/modules/trust-safety/domain/trust-overview.ts · W089's overview + W098's insights (ADMIN-5d).
//
// W098 asks the only question that matters about a trust system, and asks it in a way that refuses the easy answer:
// **"Is the marketplace getting safer without getting harsher? Both lines must trend right."** A page that reported
// only enforcement would make a platform look safest at the moment it became unusable for honest farmers.
//
// Most of what these two screens want cannot be computed today, and this module's job is to say WHICH and WHY rather
// than to fill the tiles. Verified, tile by tile:
//   COMPUTABLE — open reports and their age, appeals pending and their SLA, median time to action, reports by reason,
//                the band census.
//   NOT COMPUTABLE — "listings held" (no `held` listing state exists at all: see ADMIN-5f), "fraud loss prevented"
//                (nothing values a prevented loss), "honest-user friction / trusted users ever held" (needs holds),
//                "% of GMV touched by confirmed fraud" (no confirmed-fraud marker on an order), "94% of reporters say
//                they'd report again" (no post-outcome survey exists anywhere on the platform).
//
// A zero in any of those would be a claim, and on this page every one of them is a FLATTERING claim: nothing held,
// no friction, no fraud in the GMV. That asymmetry is why the unknown/zero distinction is enforced by the type rather
// than by remembering.
//
// SECOND INSTANCE NOTE: `tile` here and `tile` in compliance-ops/domain/posture.ts (ADMIN-5c) are the same idea, as
// are `rate` here and `rate` in schemes-oversight/domain/performance.ts (ADMIN-4b). Both are deliberately duplicated
// rather than extracted, following the rule written down in core/approval/two-person-rule.ts — two implementations is
// a coincidence, three is a pattern. The THIRD instance of either extracts to core/reporting, and this paragraph is
// the note that makes that a decision instead of a rediscovery.

export type TileUnit = 'count' | 'pct' | 'hours';
export type Tile =
  | { kind: 'value'; value: number; unit?: TileUnit; hint?: string }
  | { kind: 'unavailable'; reason: string };

/** A tile with no number reports WHY, never 0. Non-finite values are unavailable too — a NaN reaching a trust
 *  dashboard renders the literal text "NaN" beside the word "fraud". (ADMIN-5c's surviving mutant was exactly this
 *  guard, in the sibling function; the case is covered here from the start.) */
export function tile(value: number | null | undefined, reasonIfMissing: string, unit?: TileUnit, hint?: string): Tile {
  return typeof value === 'number' && Number.isFinite(value)
    ? { kind: 'value', value, ...(unit ? { unit } : {}), ...(hint ? { hint } : {}) }
    : { kind: 'unavailable', reason: reasonIfMissing };
}

/** Below this many observations a percentage is noise wearing a decimal point. W098's numbers are quoted in
 *  board packs; "18% overturn rate" from two appeals is a sentence that survives longer than the caveat. */
export const LOW_SAMPLE_BELOW = 20;

/** A rate, or nothing.
 *
 *  Returns `pct: null` when the denominator is zero — NOT 0. On this page 0% means "we act and we are never
 *  overturned", and an empty appeals register means "nobody has appealed, or nobody can". Those are different
 *  platforms.
 */
export function rate(numerator: number | null | undefined, denominator: number | null | undefined):
  { pct: number | null; lowSample: boolean; denominator: number | null } {
  if (typeof numerator !== 'number' || typeof denominator !== 'number'
      || !Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    return { pct: null, lowSample: false, denominator: null };
  }
  if (denominator <= 0) return { pct: null, lowSample: true, denominator: 0 };
  if (numerator < 0) return { pct: null, lowSample: false, denominator };
  return { pct: Math.round((numerator / denominator) * 1000) / 10, lowSample: denominator < LOW_SAMPLE_BELOW, denominator };
}

/* ------------------------------------------------------------------------------------------------ */
/* THE REASONS A TILE IS EMPTY — written once, so the same gap reads the same way on both screens     */
/* ------------------------------------------------------------------------------------------------ */

export const UNAVAILABLE = Object.freeze({
  noHeldState:
    'no listing hold exists on the platform: `listing_status` has no `held` value, and handling a report as `hidden` '
    + 'changes nothing about the listing (ADMIN-5f)',
  noFraudValuation:
    'nothing values a prevented loss — there is no confirmed-fraud marker on an order and no frozen-before-settlement '
    + 'figure to sum',
  noFrictionMeasure:
    'measuring friction on honest users requires a record of who was held, and nothing holds anything yet',
  noGmvFraudMarker: 'no order or settlement carries a confirmed-fraud marker, so no share of GMV can be attributed',
  noReporterSurvey: 'no post-outcome survey of reporters exists on the platform',
  registerUnread: 'the register could not be read',
  noActiveUserCount: 'the active-user denominator could not be read, and a share of the scored population is not the '
    + 'same figure',
} as const);

/* ------------------------------------------------------------------------------------------------ */
/* ATTENTION                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

export type AttentionSeverity = 'overdue' | 'blocking' | 'due_soon' | 'info';
export interface AttentionItem { id: string; severity: AttentionSeverity; messageKey: string; params?: Record<string, string> }

/** W089's "Needs attention" list, worst first, with a stable order inside each severity so the list does not shuffle
 *  between refreshes while somebody is reading it. */
export function orderAttention(items: readonly AttentionItem[]): AttentionItem[] {
  const rank: Record<AttentionSeverity, number> = { overdue: 0, blocking: 1, due_soon: 2, info: 3 };
  return [...items].sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id));
}

export interface SourcesRead { reports: boolean; appeals: boolean; blocklist: boolean; risk: boolean }

/** "All queues clear" is claimable ONLY when every register was actually read.
 *
 *  Same rule as ADMIN-5c's posture page and ADMIN-5's clean-record line, and it earns its place again here: W089's
 *  quiet state says "Trust ops at steady state" — an empty attention list assembled from registers that failed to
 *  load would tell a safety desk to go home.
 */
export function allQuiet(items: readonly AttentionItem[] | null | undefined, read: SourcesRead | null | undefined): boolean {
  if (!items || !read) return false;
  return items.length === 0 && read.reports && read.appeals && read.blocklist && read.risk;
}

export function unreadSources(read: SourcesRead | null | undefined): string[] {
  if (!read) return ['reports', 'appeals', 'blocklist', 'risk'];
  return (['reports', 'appeals', 'blocklist', 'risk'] as const).filter((k) => !read[k]);
}

/* ------------------------------------------------------------------------------------------------ */
/* SLA AGE                                                                                           */
/* ------------------------------------------------------------------------------------------------ */

export const REPORT_SLA_HOURS = 4;    // W089/W092
export const APPEAL_SLA_HOURS = 48;   // W089/W097

export type SlaState =
  | { kind: 'unmeasured' }
  | { kind: 'ok'; ageHours: number }
  | { kind: 'due_soon'; ageHours: number }
  | { kind: 'breached'; overHours: number };

/** Age of the oldest open item against its SLA.
 *
 *  `unmeasured` when there is no timestamp, and unmeasured is NOT ok — a queue whose oldest item has no age cannot be
 *  shown to be inside its SLA, and on W089 the oldest-item figure is the number a lead is paged on.
 *
 *  A negative age (an item timestamped in the future — clock skew, a fixture, a bad import) is unmeasured rather
 *  than comfortably inside the window, which is what taking it at face value would report.
 */
export function slaState(oldestAt: string | null | undefined, slaHours: number, now: Date): SlaState {
  if (!oldestAt) return { kind: 'unmeasured' };
  const t = Date.parse(oldestAt);
  if (!Number.isFinite(t)) return { kind: 'unmeasured' };
  const ageHours = (now.getTime() - t) / 3_600_000;
  if (ageHours < 0) return { kind: 'unmeasured' };
  if (ageHours > slaHours) return { kind: 'breached', overHours: Math.round((ageHours - slaHours) * 10) / 10 };
  // "Due soon" from three quarters of the window: on a 4-hour SLA that is one hour left, which is the point at which
  // W089 says the queue pages the lead.
  if (ageHours >= slaHours * 0.75) return { kind: 'due_soon', ageHours: Math.round(ageHours * 10) / 10 };
  return { kind: 'ok', ageHours: Math.round(ageHours * 10) / 10 };
}

/* ------------------------------------------------------------------------------------------------ */
/* REPORTS BY REASON                                                                                 */
/* ------------------------------------------------------------------------------------------------ */

export interface ReasonCount { code: string; count: number }

/** W098's "Reports by reason", biggest first.
 *
 *  A report whose reason lookup could not be resolved is counted under `unresolved` and NOT under `other`. `other` is
 *  a real reason somebody CHOSE from the list (it is seeded in `report_reason`); an unresolvable reason id is a data
 *  problem. Folding them together is the ADMIN-4b rejection-code finding exactly — it makes a broken join look like a
 *  user's choice, and the design conclusion W098 draws from this chart ("misleading_photos leads → photo-grading
 *  education card added") would then be drawn from noise.
 */
export function reasonBreakdown(rows: readonly { code: string | null; count: number }[]): { reasons: ReasonCount[]; unresolved: number; total: number } {
  let unresolved = 0;
  const map = new Map<string, number>();
  for (const r of rows) {
    const n = Number.isFinite(r.count) && r.count > 0 ? Math.trunc(r.count) : 0;
    if (!r.code) { unresolved += n; continue; }
    map.set(r.code, (map.get(r.code) ?? 0) + n);
  }
  const reasons = [...map.entries()].map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  return { reasons, unresolved, total: reasons.reduce((a, x) => a + x.count, 0) + unresolved };
}

/** Median, from a list of durations in hours. Returns null for an empty list rather than 0 — "no report has ever
 *  been actioned" and "every report is actioned instantly" are opposite facts about a moderation desk. */
export function medianHours(values: readonly number[]): number | null {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = xs.length >> 1;
  const m = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  return Math.round(m * 10) / 10;
}
