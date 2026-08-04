// apps/mobile/src/features/ambassador/targets.ts · PURE derivations for the Ambassador Monthly Targets screen
// (169). No React/native (SDK types are `import type` → erased) → unit-tested. Joins the server's per-period
// targets (AmbassadorTarget) with the ambassador's OWN real activity (referrals / visits / commission credits)
// to compute achieved-vs-target progress. The server is authoritative on the target values; these helpers only
// derive the display % / remaining / days-left with integer + bigint math (no floats, Law 2-safe).
//
// §13 (NOT faked): "achieved" is computed ONLY for metrics we can back with a real feed — onboardings (activated
// referrals in the period), visits (visits in the period), earnings_minor (commission credits in the period).
// `sales_facilitated` has NO per-ambassador achieved feed, so it degrades to progress-unknown (the screen shows
// the target with "—"), never a fabricated count. Bonus amounts / tier ladders / a satisfaction rating are NOT
// modelled here (no contract) and are omitted by the screen.
import type { AmbassadorTarget, Referral, AmbassadorVisit, AmbassadorEarning } from '@krishalaya/sdk-js';

// Referral statuses that count as a completed onboarding (an activated farmer).
const ACTIVATED = new Set(['activated', 'active', 'onboarded', 'converted', 'completed']);

/** True when an ISO date falls within [startIso, endIso] (date-only period bounds, inclusive). Pure. */
export function withinPeriod(iso: string | null | undefined, startIso: string, endIso: string): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  const s = Date.parse(startIso);
  const e = Date.parse(endIso);
  if (Number.isNaN(t) || Number.isNaN(s) || Number.isNaN(e)) return false;
  // endIso is a date (midnight UTC); include the whole end day.
  return t >= s && t <= e + 86_400_000 - 1;
}

/** The calendar-month period `offset` months from now (0 = this month, +1 = next, −1 = previous), as inclusive
 * date-only bounds 'YYYY-MM-01' … 'YYYY-MM-<lastday>' (UTC). Drives the goal-setting period + last-month actuals. */
export function monthPeriodOffset(nowMs: number, offset: number): { startIso: string; endIso: string } {
  const d = new Date(nowMs);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset + 1, 0));
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { startIso: iso(start), endIso: iso(end) };
}

/** Clamp a goal-stepper value to a whole number in [0, max]. Pure. */
export function clampGoal(n: number, max = 999): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.floor(n)));
}

/** Integer progress 0–100 = achieved / target, clamped. target ≤ 0 → 0. Pure (no floats beyond the ratio). */
export function progressPct(achieved: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((achieved * 100) / target)));
}

/** How many more to reach the target (never negative). Pure. */
export function remaining(achieved: number, target: number): number {
  return Math.max(0, target - achieved);
}

/** Whole days remaining until the period end (inclusive of the end day), clamped ≥ 0. Pure. */
export function daysLeft(periodEndIso: string, nowMs: number): number {
  const e = Date.parse(periodEndIso);
  if (Number.isNaN(e)) return 0;
  const end = e + 86_400_000; // end of the end-day
  return Math.max(0, Math.ceil((end - nowMs) / 86_400_000));
}

/** Count activated onboardings (referrals) within the period. Pure. */
export function onboardsAchieved(referrals: readonly Referral[] | null | undefined, startIso: string, endIso: string): number {
  return (referrals ?? []).filter((r) => ACTIVATED.has(r.status) && withinPeriod(r.createdAt, startIso, endIso)).length;
}

/** Count visits logged within the period. Pure. */
export function visitsAchieved(visits: readonly AmbassadorVisit[] | null | undefined, startIso: string, endIso: string): number {
  return (visits ?? []).filter((v) => withinPeriod(v.visitedAt, startIso, endIso)).length;
}

/** Sum commission CREDITS (positive earnings, excluding payouts) within the period, as bigint minor-unit string. */
export function earningsAchievedMinor(earnings: readonly AmbassadorEarning[] | null | undefined, startIso: string, endIso: string): string {
  let sum = 0n;
  for (const e of earnings ?? []) {
    if (e.payoutId) continue; // a payout row is money-out, not a credit toward the goal
    if (!withinPeriod(e.createdAt, startIso, endIso)) continue;
    try { const v = BigInt(e.amountMinor); if (v > 0n) sum += v; } catch { /* skip malformed */ }
  }
  return sum.toString();
}

export interface TargetProgress {
  metric: string;
  targetValue: number;          // parsed count (for count metrics) — 0 for money metric
  targetMinor: string | null;   // bigint minor string for 'earnings_minor', else null
  achieved: number | null;      // null = no real feed for this metric (degrade to "—")
  achievedMinor: string | null; // bigint minor string for 'earnings_minor', else null
  pct: number;                  // 0..100 (0 when achieved unknown)
  isMoney: boolean;
}

/** Resolve one target's achieved-vs-target progress from the real feeds. `null` achieved = unknown (degrade). */
export function targetProgress(
  target: AmbassadorTarget,
  feeds: { referrals?: readonly Referral[]; visits?: readonly AmbassadorVisit[]; earnings?: readonly AmbassadorEarning[] },
): TargetProgress {
  const isMoney = target.metric === 'earnings_minor';
  if (isMoney) {
    const achievedMinor = earningsAchievedMinor(feeds.earnings, target.periodStart, target.periodEnd);
    let pct = 0;
    try { const tv = BigInt(target.targetValue); if (tv > 0n) pct = Number((BigInt(achievedMinor) * 100n) / tv); } catch { pct = 0; }
    return { metric: target.metric, targetValue: 0, targetMinor: target.targetValue, achieved: null, achievedMinor, pct: Math.max(0, Math.min(100, pct)), isMoney: true };
  }
  const targetValue = Number.parseInt(target.targetValue, 10) || 0;
  let achieved: number | null = null;
  if (target.metric === 'onboardings') achieved = onboardsAchieved(feeds.referrals, target.periodStart, target.periodEnd);
  else if (target.metric === 'visits') achieved = visitsAchieved(feeds.visits, target.periodStart, target.periodEnd);
  // 'sales_facilitated' and any unknown metric: no real feed → achieved stays null (degrade to "—").
  return { metric: target.metric, targetValue, targetMinor: null, achieved, achievedMinor: null, pct: achieved == null ? 0 : progressPct(achieved, targetValue), isMoney: false };
}
