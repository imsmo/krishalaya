// apps/web-tenant/src/features/console/home.ts · pure presentation logic for W117 and W116 (PC-56 TENANT-1c).
//
// No React, no I/O. Everything here is a rule about **not manufacturing urgency and not inventing progress** — the two ways
// a console home can lie to the person who opens it first every morning.
import type { DashboardAction, DashboardTiles, GoLiveState, GoLiveStep, TenantPlanHealth } from '@krishalaya/sdk-js';

export interface T { t(key: string, vars?: Record<string, string | number>): string }

/**
 * How the GMV change reads.
 *
 * **`unknown` IS A THIRD STATE AND IT IS NOT ZERO.** A federation in its first month has no previous window, so there is
 * nothing to compare — and rendering "▲ 0%" or "—0%" invites a coordinator to conclude that trade is flat when in fact it is
 * new. W117's tile shows a comparison because the canon's tenant has a June; a tenant without one is told so.
 */
export function gmvTrend(t: DashboardTiles): { dir: 'up' | 'down' | 'flat' | 'unknown'; pct: number | null } {
  if (t.gmvChangeBp === null) return { dir: 'unknown', pct: null };
  // Basis points to whole percent, rounded toward zero: 1830bp reads as 18%, matching the canon, and a 4bp wobble reads as
  // 0% rather than as a suspiciously precise 0.04%.
  const pct = Math.trunc(t.gmvChangeBp / 100);
  if (pct > 0) return { dir: 'up', pct };
  if (pct < 0) return { dir: 'down', pct };
  return { dir: 'flat', pct: 0 };
}

/**
 * Is today quiet?
 *
 * **THE CANON MAKES THIS AN EXPLICIT STATE, NOT AN EMPTY LIST.** W117: "A quiet day · No approvals, no disputes, payouts on
 * autopilot. The dashboard stays honest — no manufactured urgency." A blank panel looks like a failed load; a sentence
 * saying there is nothing to do is information a coordinator can act on — by going and doing something else.
 */
export function isQuietDay(actions: DashboardAction[]): boolean {
  return actions.length === 0;
}

/**
 * The order the actions are shown in.
 *
 * **BY WHAT GOES WRONG IF IT WAITS, NOT BY MONEY.** A payout batch is the largest number on the screen, and it is NOT first:
 * a batch waits until the next run without harm, while produce in QC is perishable and a dispute has a response clock the
 * platform will judge the tenant against. Sorting by rupees would put the calmest item at the top every single day.
 */
const URGENCY: Record<DashboardAction['kind'], number> = { dispute: 0, qc_queue: 1, payout_batch: 2 };

export function orderedActions(actions: DashboardAction[]): DashboardAction[] {
  return [...actions].sort((a, b) => {
    const byKind = URGENCY[a.kind] - URGENCY[b.kind];
    if (byKind !== 0) return byKind;
    // Within a kind, oldest first — the age is the thing that makes one of two disputes the urgent one.
    return (b.oldestHours ?? 0) - (a.oldestHours ?? 0);
  });
}

/**
 * How an action's age reads.
 *
 * **HOURS UNDER A DAY, DAYS ABOVE IT.** "38.4h" is a number a person has to convert; "2 days" is one they can act on. And a
 * null age says nothing rather than "0h", because an item whose age we do not know is not a brand-new item.
 */
export function ageLabel(hours: number | null, t: T): string | null {
  if (hours === null || !Number.isFinite(hours)) return null;
  if (hours < 1) return t.t('home.age.minutes', { n: Math.max(1, Math.round(hours * 60)) });
  if (hours < 24) return t.t('home.age.hours', { n: Number(hours.toFixed(1)) });
  return t.t('home.age.days', { n: Math.floor(hours / 24) });
}

/**
 * Plan usage as a share.
 *
 * **null WHEN THERE IS NO CAP, WHICH IS NOT THE SAME AS 0% USED.** An enterprise plan with unlimited members would otherwise
 * render a progress bar at 0% forever, which reads as "you have used nothing" to somebody with 40,000 members.
 */
export function planUsagePct(p: TenantPlanHealth): number | null {
  if (p.memberLimit === null || p.memberLimit <= 0) return null;
  return Math.min(100, Math.floor((p.membersUsed / p.memberLimit) * 100));
}

/** True when the tenant is close enough to its cap that a coordinator should know before they run an import. 90% is a
 *  judgement, stated: below it the warning is noise, above it the next bulk import is the one that fails. */
export function planNearLimit(p: TenantPlanHealth): boolean {
  const pct = planUsagePct(p);
  return pct !== null && pct >= 90;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* W116                                                                                                          */
/* ------------------------------------------------------------------------------------------------------------ */

/**
 * The badge a step carries.
 *
 * Four states and not two, because W116 renders four: done with a timestamp, the one to do next, a step that is waiting on
 * another, and the rest — which are available but not urgent. Collapsing "blocked" into "todo" would send a federation to a
 * payouts screen that will refuse them until KYC verifies.
 */
export function stepBadge(s: GoLiveStep): 'done' | 'next' | 'blocked' | 'todo' {
  if (s.done) return 'done';
  if (s.blockedBy) return 'blocked';
  return s.isNext ? 'next' : 'todo';
}

/**
 * **EXACTLY ONE STEP MAY BE "next".** The API decides it, and this asserts the invariant the screen depends on: two "next"
 * badges is a screen that cannot tell somebody what to do, which is the only job this page has.
 */
export function nextStep(state: GoLiveState): GoLiveStep | null {
  const next = state.steps.filter((s) => stepBadge(s) === 'next');
  return next.length === 1 ? next[0] : null;
}

/**
 * Should the checklist still be the console's front door?
 *
 * W116's completed state says the page "becomes your health check — it returns whenever something needs attention", so it
 * does not vanish on completion. But a LIVE federation should land on the dashboard, not on a page of ticks.
 */
export function showChecklistFirst(state: GoLiveState): boolean {
  return !state.live;
}
