// modules/tenancy/domain/billing-grace.ts · W120's grace period as PURE rules (PC-56 TENANT-4d-4).
//
// No I/O, no clock of its own — `now` is always passed in. This file is the whole billing lifecycle in one
// place, because it was previously spread across four unscheduled job classes that disagreed with each other:
//
//   period end, invoice unpaid   →  enter grace   (past_due, grace_until = period end + grace days)
//   invoice paid                 →  roll period   (past_due|active → active, window cleared)
//   grace window closed, unpaid  →  expire
//
// THE THING THAT MADE THIS URGENT: nothing in the monorepo advanced `current_period_end` (0148 defect 1), so
// `findDueToExpire` matched every live subscription within a month of creation and would have expired a tenant
// who paid on time exactly as fast as one who never paid. The middle rule above is the one that was missing.
import { SubscriptionStatus } from './subscription.state';
import { retryAndNotifyVerdict } from './billing-notice';

/** W120's number, and the fallback for a malformed setting. NEVER 0 — see graceDaysFrom. */
export const DEFAULT_GRACE_DAYS = 7;
export const MIN_GRACE_DAYS = 1;
export const MAX_GRACE_DAYS = 90;

/**
 * The grace length in force for a tenant, from `billing.grace_days`.
 *
 * A malformed, missing, or out-of-range value falls back to the DEFAULT, never to zero. Zero would switch a
 * tenant off the instant their period ended — the exact behaviour this wave removes — and it is what a typo,
 * an empty string, or `Number(undefined)` all produce. Turning the grace period off is what the
 * `saas_billing_grace` flag is for; it is not a value.
 */
export function graceDaysFrom(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_GRACE_DAYS;
  const i = Math.floor(n);
  return i >= MIN_GRACE_DAYS && i <= MAX_GRACE_DAYS ? i : DEFAULT_GRACE_DAYS;
}

/** The date the window closes: the period end plus N whole days, as YYYY-MM-DD. Date arithmetic in UTC on a
 *  calendar date, so a tenant gets whole days rather than a window that ends mid-afternoon in the platform's
 *  timezone (the hidden-timezone defect TENANT-4b found in a wall-clock cut-off). */
export function graceUntil(periodEnd: Date, days: number): string {
  const d = new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), periodEnd.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** Is the window still open as at `now`? Inclusive of the closing DAY: a window "through 20 Jul" covers all of
 *  20 Jul, because that is what a tenant reading "7 days" counts. */
export function graceOpen(graceUntilDate: string | null, now: Date): boolean {
  return graceUntilDate !== null && dayOf(now) <= graceUntilDate;
}

/** Whole days left, floored at 0 — what the console prints ("service continues for 4 more days"). */
export function graceDaysLeft(graceUntilDate: string | null, now: Date): number {
  if (graceUntilDate === null) return 0;
  const end = Date.parse(`${graceUntilDate}T00:00:00Z`);
  const today = Date.parse(`${dayOf(now)}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(today)) return 0;
  const days = Math.floor((end - today) / 86_400_000);
  return days > 0 ? days : 0;
}

/* ------------------------------------------------------------------------------------------------------- */
/* WHAT THE SWEEP SHOULD DO WITH ONE SUBSCRIPTION                                                          */
/* ------------------------------------------------------------------------------------------------------- */

export interface SweepInput {
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
  graceUntil: string | null;
  cancelAtPeriodEnd: boolean;
  /** How much this subscription still OWES across its issued/part-paid/overdue invoices, in minor units. */
  owingMinor: bigint;
  now: Date;
  /** `saas_billing_grace`. OFF reproduces the pre-wave behaviour exactly. */
  graceEnabled: boolean;
}

export type SweepAction =
  /** The period has ended, money is owed, and no window is open yet → past_due + grace_until. The window's
   *  LENGTH is not decided here: it comes from `billing.grace_days` for that tenant, which the caller
   *  resolves and passes to `graceUntil`. A pure decision function has no business reading a setting. */
  | { kind: 'enter_grace' }
  /** The window has closed and money is still owed → expired. The ONLY path to expiry for an unpaid tenant. */
  | { kind: 'expire'; reason: 'grace_lapsed' }
  /** A cancel-at-period-end that has arrived. Not a billing failure — the tenant asked. No grace applies. */
  | { kind: 'expire'; reason: 'cancelled_at_period_end' }
  /** Pre-wave behaviour, only reachable with the flag OFF: period end, no grace state to enter. */
  | { kind: 'expire'; reason: 'legacy_no_grace' }
  /** Nothing to do, with the reason — so a tick that does nothing can say WHY it did nothing. */
  | { kind: 'wait'; reason: 'period_open' | 'in_grace' | 'nothing_owed' | 'not_live' };

/**
 * The single decision the cadence makes per subscription.
 *
 * ORDER MATTERS AND IS THE POINT:
 *   1. a subscription that is not live is nobody's business here;
 *   2. a cancel-at-period-end that has arrived expires — the tenant ASKED, so a grace period would be the
 *      platform refusing to let go, not a kindness;
 *   3. a period that has not ended yet waits;
 *   4. **NOTHING OWED WAITS, IT DOES NOT EXPIRE.** This is the rule whose absence made the old sweep a
 *      platform-wide kill switch: a tenant whose invoice is paid has a stale `current_period_end` only
 *      because nothing rolled it, and expiring them for that would be punishing us for our own bug. The
 *      period is rolled by the PAID event (see SubscriptionService.rollPeriod), not by this sweep;
 *   5. an open window waits;
 *   6. a closed window with money owed expires.
 */
export function sweepAction(i: SweepInput): SweepAction {
  if (i.status !== 'active' && i.status !== 'past_due' && i.status !== 'trialing' && i.status !== 'paused') {
    return { kind: 'wait', reason: 'not_live' };
  }
  // The period end is a timestamptz and is compared as an instant. (The DATE reasoning applies to the grace
  // WINDOW, which is counted in whole days — see graceUntil/graceOpen.)
  const ended = i.currentPeriodEnd.getTime() <= i.now.getTime();
  if (i.cancelAtPeriodEnd && ended) return { kind: 'expire', reason: 'cancelled_at_period_end' };
  if (!ended) return { kind: 'wait', reason: 'period_open' };
  if (i.owingMinor <= 0n) {
    // Paid up (or never billed). The period will roll when the renewal invoice is paid; until then this
    // subscription is simply waiting, and it must NOT be switched off.
    return { kind: 'wait', reason: 'nothing_owed' };
  }
  if (!i.graceEnabled) return { kind: 'expire', reason: 'legacy_no_grace' };
  if (i.status !== 'past_due') return { kind: 'enter_grace' };
  if (graceOpen(i.graceUntil, i.now)) return { kind: 'wait', reason: 'in_grace' };
  return { kind: 'expire', reason: 'grace_lapsed' };
}

/* ------------------------------------------------------------------------------------------------------- */
/* WHAT THE CONSOLE MAY SAY (W120's footnote, honestly)                                                    */
/* ------------------------------------------------------------------------------------------------------- */

/**
 * The four sentences W120 states about the billing mechanism, now DERIVED from what is actually switched on
 * rather than hardcoded to "missing" (TENANT-4d-2) — so the screen tells the truth in both states and cannot
 * go stale the way a constant does.
 *
 * `retryAndNotify` covers TWO mechanisms in one canon sentence — "while we retry and notify you" — and
 * TENANT-4d-2 gave it the single verdict `no_notification` because neither half existed. **PC-56 TENANT-4d-5
 * BUILDS THE NOTIFY HALF AND NOT THE RETRY HALF, SO THE SENTENCE SPLITS RATHER THAN FLIPPING**, and the
 * constant becomes derived — the same lesson 4d-4 learned when `gracePeriod` stopped being hardcoded:
 *   • there is still no autopay MANDATE for a subscription anywhere in the payments module, so there is no
 *     instrument to retry against. "We retry" has no subject and this wave does not give it one;
 *   • the notify half is now real: seven tenancy events have map rows, catalog codes and templates in three
 *     languages, and `BillingNoticeService` puts a recipient in each payload. So `no_notification` would now be
 *     the false statement — it would tell a tenant we will not contact them immediately after we did.
 * `notify_only` is the third verdict and the true one: we will tell you, and you pay it yourself.
 */
export type MechanismVerdict = 'exists' | 'no_saas_mandate' | 'not_scheduled' | 'no_grace_state' | 'no_notification' | 'notify_only';

export interface MechanismInputs { graceEnabled: boolean; cadenceEnabled: boolean; notificationsEnabled: boolean }

export function mechanismLines(i: MechanismInputs): {
  autopay: MechanismVerdict; nextDebit: MechanismVerdict; gracePeriod: MechanismVerdict; retryAndNotify: MechanismVerdict;
} {
  return {
    // Unchanged by this wave: the autopay plane still has no notion of a subscription or a SaaS invoice.
    autopay: 'no_saas_mandate',
    // A "next debit" needs both a schedule AND something to debit. The cadence being on gives the first only,
    // so this stays a gap until an autopay mandate exists — a scheduled INVOICE is not a scheduled debit.
    nextDebit: 'no_saas_mandate',
    // The one W120 promise this wave makes true. Both switches are required: a state nothing sweeps never
    // opens a window, and a sweep with no state to enter is the old kill switch.
    gracePeriod: i.graceEnabled && i.cadenceEnabled ? 'exists' : i.graceEnabled ? 'not_scheduled' : 'no_grace_state',
    retryAndNotify: retryAndNotifyVerdict({ notificationsEnabled: i.notificationsEnabled }),
  };
}

/** What the tenant should DO while in grace — and it is not "wait for us to retry", because we do not.
 *  W2428's self-pay is the real action, which 4d-2 built. */
export type GraceAdvice = 'pay_open_invoice' | 'contact_platform' | 'none';

export function graceAdvice(p: { inGrace: boolean; selfPayEnabled: boolean }): GraceAdvice {
  if (!p.inGrace) return 'none';
  return p.selfPayEnabled ? 'pay_open_invoice' : 'contact_platform';
}
