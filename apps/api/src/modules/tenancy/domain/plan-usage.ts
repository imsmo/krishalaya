// modules/tenancy/domain/plan-usage.ts · W118's meters as PURE rules (PC-56 TENANT-4d-1).
// The registry that makes the plan's limits and the platform's counters speak one vocabulary, the
// stock/flow distinction that keeps a meter from drifting, and the rule W118 states under its cards.
import { DomainError } from '../../../shared/errors/app-error';

export class PlanUsageError extends DomainError {}

/* ------------------------------------------------------------------------------------------------
 * STOCK vs FLOW — the distinction the counter table cannot make on its own
 * ---------------------------------------------------------------------------------------------- */

/** A FLOW accumulates over a period and resets (orders this month, API calls this month): `usage_counters`
 *  is exactly right for it. A STOCK is a level that goes DOWN as well as up (members, staff seats, stored
 *  bytes). Accumulating a stock into a monthly counter drifts the moment one is removed, and the drift is
 *  invisible — the meter reads 1,284 for ever while the roster shows 1,190. Stocks are counted LIVE. */
export type MetricShape = 'stock' | 'flow';

/** What the platform can honestly say about a meter today.
 *   enforced      — counted, limited, and a write is refused at 100%;
 *   counted_only  — the figure is real and the limit is real, but nothing refuses at the limit;
 *   not_measured  — no counter and no limit exist. The screen says so instead of drawing an empty bar,
 *                   because a meter reading 0 of 500,000 looks like generous headroom, not like ignorance. */
export type MeterState = 'enforced' | 'counted_only' | 'not_measured';

export interface MetricDef {
  /** The key W118's card is drawn from. */
  code: string;
  shape: MetricShape;
  /** The `plan_limits.limit_code` this meter is measured against, or null when no plan defines one. */
  limitCode: string | null;
  /** Where the used figure comes from — a live count from a table, a monthly counter row, or nowhere. */
  source: 'live_count' | 'usage_counter' | 'none';
  /** The code path that refuses at 100%, or null when nothing does. A registry in code, not a column: "who
   *  enforces this" is a fact about the codebase, and a data column claiming it would drift the moment a
   *  new call site appeared (the rule TENANT-3c-2 set for charge surfaces). */
  enforcedBy: string | null;
}

/** W118's four cards, in the order it draws them, with the truth about each. Verified 2026-08-18 by reading
 *  every `assertWithinLimit` call site and every seeded `plan_limits` row. */
export const PLAN_METRICS: readonly MetricDef[] = Object.freeze([
  { code: 'members', shape: 'stock', limitCode: 'max_farmers', source: 'live_count', enforcedBy: 'identity.member_add' },
  // A "seat" is what the product sells, and `roles` has no column for it — see STAFF_SEAT_ROLES below.
  { code: 'staff_seats', shape: 'stock', limitCode: null, source: 'live_count', enforcedBy: null },
  // No metering middleware writes an api_calls counter, and no plan defines a limit for one.
  { code: 'api_calls', shape: 'flow', limitCode: null, source: 'none', enforcedBy: null },
  { code: 'storage_gb', shape: 'stock', limitCode: null, source: 'none', enforcedBy: null },
]);

export function metricDef(code: string): MetricDef | null {
  return PLAN_METRICS.find((m) => m.code === code) ?? null;
}

/** THE THIRTEEN metric codes that thirteen modules already assert against, and that NO plan seeds a limit
 *  for — so every one of those gates returns "unlimited" on every call. Listed here, in code, so the
 *  founder's pricing decision has a checklist and so a spec can prove the list has not silently grown.
 *  Verified 2026-08-18 across apps/api (`const QUOTA_METRIC =`). */
export const ASSERTED_BUT_UNPRICED: readonly string[] = Object.freeze([
  'animals', 'equipment_assets', 'export_shipments', 'farming_contracts', 'insurance_claims',
  'insurance_policies', 'labour_bookings', 'land_parcels', 'loan_applications', 'max_listings_month',
  'scheme_applications', 'service_offerings', 'warehouses',
]);

/** The limit codes db/seeds/rules/0201 actually seeds. The intersection with the list above is EMPTY, and a
 *  spec asserts that it stays empty until somebody prices them — at which point the spec fails and is
 *  updated deliberately, which is the point. */
export const SEEDED_LIMIT_CODES: readonly string[] = Object.freeze(['max_farmers', 'max_languages', 'max_orders_month']);

/** Which tenant roles occupy a paid STAFF SEAT. W118 meters "Staff seats 7 / 10" and nothing in the schema
 *  distinguishes a seat from a membership: `roles.scope` is platform|tenant, and `farmer` and `tenant_admin`
 *  are both 'tenant'. This is the product's answer, declared where a reader can find it — and the screen
 *  says a column would be better once pricing defines a seat. */
export const STAFF_SEAT_ROLES: readonly string[] = Object.freeze([
  'tenant_admin', 'tenant_staff', 'support_agent', 'auditor', 'fpo_coordinator',
]);

export function isStaffSeatRole(roleCode: string): boolean {
  return STAFF_SEAT_ROLES.includes(roleCode);
}

/* ------------------------------------------------------------------------------------------------
 * THE METER
 * ---------------------------------------------------------------------------------------------- */

export const DEFAULT_ALERT_THRESHOLD_PCT = 90;

/** A threshold outside 1..100 falls back to the published default — never to 0, which would alert on every
 *  metric for every tenant for ever, and never to 100, which would alert only after the pause. */
export function alertThresholdPct(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : DEFAULT_ALERT_THRESHOLD_PCT;
}

export interface MeterInput {
  code: string;
  /** null = the figure could not be read (no counter, no source). NOT the same as zero. */
  usedValue: number | null;
  /** null = no plan limit defines this metric; -1 = explicitly unlimited (0201's convention). */
  limitValue: number | null;
}

export type MeterVerdict =
  | { kind: 'not_measured'; reason: 'no_source' | 'no_limit' }
  | { kind: 'unlimited'; used: number }
  | { kind: 'within'; used: number; limit: number; pct: number; atNotice: boolean }
  | { kind: 'at_limit'; used: number; limit: number; pct: 100 }
  /** Over the limit — possible whenever enforcement was off, or a limit was lowered under a live tenant.
   *  Reported as its own case: clamping it to 100% would hide that additions are already being refused. */
  | { kind: 'over_limit'; used: number; limit: number; pct: number };

export function meterVerdict(m: MeterInput, thresholdPct = DEFAULT_ALERT_THRESHOLD_PCT): MeterVerdict {
  const def = metricDef(m.code);
  if (m.usedValue === null || def?.source === 'none') return { kind: 'not_measured', reason: 'no_source' };
  if (m.limitValue === null) return { kind: 'not_measured', reason: 'no_limit' };
  if (m.limitValue < 0) return { kind: 'unlimited', used: m.usedValue };
  if (m.limitValue === 0) {
    return m.usedValue > 0
      ? { kind: 'over_limit', used: m.usedValue, limit: 0, pct: 100 }
      : { kind: 'at_limit', used: 0, limit: 0, pct: 100 };
  }
  const pct = Math.floor((m.usedValue / m.limitValue) * 100);
  if (m.usedValue > m.limitValue) return { kind: 'over_limit', used: m.usedValue, limit: m.limitValue, pct };
  if (m.usedValue === m.limitValue) return { kind: 'at_limit', used: m.usedValue, limit: m.limitValue, pct: 100 };
  return { kind: 'within', used: m.usedValue, limit: m.limitValue, pct, atNotice: pct >= thresholdPct };
}

/** What the meter can honestly claim about itself, combining the registry with the reading. */
export function meterState(m: MeterInput, enforcementOn: boolean): MeterState {
  const def = metricDef(m.code);
  if (!def || def.source === 'none' || m.limitValue === null) return 'not_measured';
  return def.enforcedBy && enforcementOn ? 'enforced' : 'counted_only';
}

/* ------------------------------------------------------------------------------------------------
 * THE PAUSE (W118: "at 100% new additions pause — existing operations never do")
 * ---------------------------------------------------------------------------------------------- */

export type AdditionVerdict =
  | { kind: 'allow' }
  | { kind: 'allow_unenforced'; pct: number }        // the flag is off: the screen said so, and so does this
  | { kind: 'refuse'; used: number; limit: number };

/** May one more of this stock be added? Note what is NOT here: any notion of blocking an EXISTING operation.
 *  A tenant at 100% of its member limit keeps trading, keeps paying its farmers, keeps closing cycles — the
 *  only thing that pauses is adding another member. W118 says exactly that, and it is the difference between
 *  a limit and a hostage. */
export function additionVerdict(
  m: { usedValue: number; limitValue: number | null },
  enforcementOn: boolean,
): AdditionVerdict {
  if (m.limitValue === null || m.limitValue < 0) return { kind: 'allow' };          // unpriced or unlimited
  const pct = m.limitValue === 0 ? 100 : Math.floor((m.usedValue / m.limitValue) * 100);
  if (m.usedValue < m.limitValue) return { kind: 'allow' };
  return enforcementOn ? { kind: 'refuse', used: m.usedValue, limit: m.limitValue } : { kind: 'allow_unenforced', pct };
}

/* ------------------------------------------------------------------------------------------------
 * THE TRIAL CARRIES THE PLAN'S LIMITS
 * ---------------------------------------------------------------------------------------------- */

/** `subscription.state.ts` grants quota only while `active`, so a trialing tenant escapes every limit —
 *  while W115 sells "14 days free" on a CHOSEN plan, which is a trial of that plan's limits. A fresh trial
 *  is also the cheapest place to mine a platform, so exempting it is backwards. `past_due` keeps its limits
 *  too: a tenant in the grace period is still operating on the plan they have not yet paid for. */
export const QUOTA_BEARING_STATUSES: readonly string[] = Object.freeze(['trialing', 'active', 'past_due']);

export function statusBearsQuota(status: string): boolean {
  return QUOTA_BEARING_STATUSES.includes(status);
}

/* ------------------------------------------------------------------------------------------------
 * W115's PLAN CHOICE, and W118's PRICE LOCK
 * ---------------------------------------------------------------------------------------------- */

/** A plan a tenant may choose at signup: public, active, and offered for their country. Anything else is
 *  refused BY NAME rather than quietly falling back to the platform default — a co-operative that picked
 *  Professional and silently got Starter would find out from an invoice. */
export interface ChoosablePlan { code: string; version: number; isPublic: boolean; isActive: boolean; countryCode: string | null }

export type PlanChoiceRefusal = 'SIGNUP_PLAN_NOT_PUBLIC' | 'SIGNUP_PLAN_NOT_FOR_COUNTRY' | 'SIGNUP_PLAN_UNKNOWN';

export function planChoiceRefusal(code: string, countryCode: string, plans: readonly ChoosablePlan[]): PlanChoiceRefusal | null {
  const forCode = plans.filter((p) => p.code === code);
  if (forCode.length === 0) return 'SIGNUP_PLAN_UNKNOWN';
  const live = forCode.filter((p) => p.isActive);
  if (live.length === 0 || !live.some((p) => p.isPublic)) return 'SIGNUP_PLAN_NOT_PUBLIC';
  if (!live.some((p) => p.countryCode === null || p.countryCode === countryCode)) return 'SIGNUP_PLAN_NOT_FOR_COUNTRY';
  return null;
}

/** W118's "Growth (v3, price-locked)". The lock is real because `subscriptions.plan_id` points at one
 *  versioned `plans` row (UNIQUE (code, version, country_code)) and a price change is a NEW row — so this
 *  is a label, not a claim: it prints the version the tenant is actually pinned to. */
export function planLabel(planName: string, version: number | null): string {
  return version === null ? planName : `${planName} (v${version})`;
}

/** W118's projection: "your member count grows ~90/month — at this rate you reach the 5,000 limit around
 *  Dec 2029". It needs HISTORY. With fewer than two observations there is no rate, and the screen says the
 *  projection is not available yet rather than drawing a line through one point. */
export type Projection =
  | { kind: 'not_available'; reason: 'insufficient_history' | 'no_limit' | 'not_growing' }
  | { kind: 'reaches'; monthsAway: number; perMonth: number };

export function projectLimit(
  history: ReadonlyArray<{ month: string; value: number }>,
  limitValue: number | null,
): Projection {
  if (limitValue === null || limitValue < 0) return { kind: 'not_available', reason: 'no_limit' };
  if (history.length < 2) return { kind: 'not_available', reason: 'insufficient_history' };
  const sorted = [...history].sort((a, b) => a.month.localeCompare(b.month));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = sorted.length - 1;
  const perMonth = (last.value - first.value) / span;
  if (perMonth <= 0) return { kind: 'not_available', reason: 'not_growing' };
  const remaining = limitValue - last.value;
  if (remaining <= 0) return { kind: 'reaches', monthsAway: 0, perMonth: Math.round(perMonth) };
  return { kind: 'reaches', monthsAway: Math.ceil(remaining / perMonth), perMonth: Math.round(perMonth) };
}
