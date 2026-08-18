// apps/web-tenant/src/features/billing/usage.ts · W118's meters as PURE rules (PC-56 TENANT-4d-1).
// No React, no I/O — unit- and mutation-tested, and the API re-enforces every one.

export const METER_ORDER = ['members', 'staff_seats', 'api_calls', 'storage_gb'] as const;
export type MeterCode = (typeof METER_ORDER)[number];

export type MeterState = 'enforced' | 'counted_only' | 'not_measured';

/** THE THREE STATES A METER MAY BE IN, and they must look different. `not_measured` is the one that matters:
 *  a bar drawn at 0 of 500,000 reads as generous headroom, when the truth is that nothing counts this at all.
 *  So an unmeasured meter shows NO BAR and says why. */
export function meterBadgeKey(state: MeterState): string {
  return `pu.state.${state === 'enforced' ? 'enforced' : state === 'counted_only' ? 'countedOnly' : 'notMeasured'}`;
}

export function showsBar(state: MeterState): boolean {
  return state !== 'not_measured';
}

export type Verdict =
  | { kind: 'not_measured'; reason: 'no_source' | 'no_limit' }
  | { kind: 'unlimited'; used: number }
  | { kind: 'within'; used: number; limit: number; pct: number; atNotice: boolean }
  | { kind: 'at_limit'; used: number; limit: number; pct: 100 }
  | { kind: 'over_limit'; used: number; limit: number; pct: number };

/** The figure line under a meter's title. Each verdict gets its own sentence — an `over_limit` meter is NOT
 *  clamped to 100%, because clamping would hide that additions are already being refused. */
export function verdictKey(v: Verdict): string {
  if (v.kind === 'not_measured') return v.reason === 'no_limit' ? 'pu.verdict.noLimit' : 'pu.verdict.noSource';
  if (v.kind === 'unlimited') return 'pu.verdict.unlimited';
  if (v.kind === 'at_limit') return 'pu.verdict.atLimit';
  if (v.kind === 'over_limit') return 'pu.verdict.overLimit';
  return v.atNotice ? 'pu.verdict.withinNotice' : 'pu.verdict.within';
}

/** The width of the bar, capped at 100 for layout but never used to decide the WORDS — those come from the
 *  verdict, so a meter over its limit still says so even though its bar cannot grow past the box. */
export function barPct(v: Verdict): number | null {
  if (v.kind === 'not_measured' || v.kind === 'unlimited') return null;
  if (v.kind === 'at_limit') return 100;
  return Math.min(100, Math.max(0, v.pct));
}

export function needsAttention(v: Verdict): boolean {
  return v.kind === 'at_limit' || v.kind === 'over_limit' || (v.kind === 'within' && v.atNotice);
}

/** W118's projection line. `not_available` is three different reasons and each says which — "we cannot
 *  project from one month of history" is useful, "no projection" is not. */
export type Projection =
  | { kind: 'not_available'; reason: 'insufficient_history' | 'no_limit' | 'not_growing' }
  | { kind: 'reaches'; monthsAway: number; perMonth: number };

export function projectionKey(p: Projection): string {
  if (p.kind === 'reaches') return p.monthsAway === 0 ? 'pu.projection.reached' : 'pu.projection.reaches';
  return `pu.projection.${p.reason === 'insufficient_history' ? 'noHistory' : p.reason === 'no_limit' ? 'noLimit' : 'notGrowing'}`;
}

/** The month a projection lands in, rendered from a count of months so the screen never does date maths on a
 *  string. Returns 'YYYY-MM'. */
export function projectedMonth(now: Date, monthsAway: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsAway, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** W118's own promise, stated with the number ACTUALLY in force rather than the canon's 90. A tenant that
 *  moved its threshold sees its own. */
export function noticeRuleKey(enforcementOn: boolean): 'pu.rule.enforced' | 'pu.rule.displayOnly' {
  return enforcementOn ? 'pu.rule.enforced' : 'pu.rule.displayOnly';
}

/** Whether the limits apply at all: a paused/cancelled/expired subscription has no plan in force to take a
 *  limit from, and the screen says that instead of drawing meters against a plan nobody is on. */
export function limitsApplyKey(status: string | null, limitsApply: boolean): string {
  if (!status) return 'pu.status.noSubscription';
  if (!limitsApply) return 'pu.status.limitsSuspended';
  return `pu.status.${status === 'trialing' ? 'trialing' : status === 'past_due' ? 'pastDue' : 'active'}`;
}

/** W115's cards. A plan a co-operative may choose, with its price in MINOR UNITS (never a float) and the
 *  member limit that actually differentiates the tiers. */
export interface PlanCard {
  code: string; version: number; name: string; monthlyPriceMinor: string; annualPriceMinor: string;
  currencyCode: string; limits: Record<string, number>;
}

export function memberLimitOf(card: PlanCard): number | null {
  const v = card.limits.max_farmers;
  return v === undefined ? null : v;
}

/** The limit label for a card: a number, "unlimited" for -1 (0201's convention), or "not stated" where the
 *  plan defines none — which is different from unlimited and must not be printed as it. */
export function limitLabelKey(limit: number | null): 'pu.limit.count' | 'pu.limit.unlimited' | 'pu.limit.notStated' {
  if (limit === null) return 'pu.limit.notStated';
  return limit < 0 ? 'pu.limit.unlimited' : 'pu.limit.count';
}

/** ANNUAL IS NOT "×12 MINUS TWO MONTHS" COMPUTED ON THE SCREEN. W115 advertises "Annual · 2 months free", and
 *  the saving is whatever the two stored prices actually differ by — computed from them, in minor units, so a
 *  card can never advertise a discount the invoice will not honour. */
export function annualSavingMinor(card: PlanCard): string {
  const twelve = BigInt(card.monthlyPriceMinor) * 12n;
  const annual = BigInt(card.annualPriceMinor);
  const saving = twelve - annual;
  return (saving > 0n ? saving : 0n).toString();
}

export function hasAnnualSaving(card: PlanCard): boolean {
  return annualSavingMinor(card) !== '0';
}

/** Every refusal the API can return on these surfaces, translated BY NAME. */
export const REFUSALS: Record<string, string> = {
  PLAN_MEMBER_LIMIT_REACHED: 'memberLimit',
  SIGNUP_PLAN_NOT_OFFERED: 'planNotOffered',
  SIGNUP_TRIAL_PLAN_UNAVAILABLE: 'planUnavailable',
};

export function refusalKey(code: string): string {
  return `pu.err.${REFUSALS[code] ?? 'generic'}`;
}
