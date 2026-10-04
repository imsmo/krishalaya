// modules/ambassadors/domain/payout-run.ts · PC-56 TENANT-SW-b · A — THE WEEKLY AMBASSADOR RUN, AS ARITHMETIC. PURE.
//
// Founder decision (2026-10-03, closes 10a F-23 / SWEEP F-17): AMBASSADOR PAY COMES FROM THE TENANT'S OWN WALLET, UNDER
// MAKER-CHECKER. 10a paid every line from `platform(Fees)` — the platform's fee account paid a cooperative's village agents. That
// leg is REPLACED: a confirmed run pays each ambassador ONE balanced WalletPort txn
//
//     tenant Main(tenant)   −(commission + stipend)
//     user Main(ambassador) +(commission + stipend)          key ambrun:<runId>:<ambassadorId> · txn type `ambassador_run`
//
// THE CLOCK (canon W161: "auto-prepared Thu 23:00", "pays Friday"). Every instant here is Asia/Kolkata wall time (UTC+05:30, no
// DST): a weekly run's period ends at the most recent Thursday 23:00 IST; it pays on the following Friday — when its checker
// confirms (no money moves on a clock; the date is the canon's promise, printed, not a timer).
//
// THE STIPEND (`ambassador_profiles.monthly_stipend_minor`). A weekly run carries the stipend for the latest month that has fully
// ENDED by its period end, for an ambassador who was an active ambassador for that WHOLE month (enrolled before the month began,
// active now, no suspension recorded during it). Pro-rata is REFUSED BY NAME: the first stipend is for the first full month.
// Paid once per (ambassador, month) — `ambassador_stipend_payments` UNIQUE is the wall.
import { AccountRef, TenantAccount, userMain } from '../../../core/wallet/account-codes';
import { LedgerLeg } from '../../../core/wallet/wallet.port';

export const AMBASSADOR_RUN_TXN = 'ambassador_run';
export const RUN_LINE_REFERENCE_TYPE = 'ambassador_payout_run_line';
export const OPEN_RUN_STATUSES = ['prepared', 'confirmed', 'partially_paid', 'unfunded'] as const;
export const RUN_STATUSES = ['prepared', 'confirmed', 'refused', 'paid', 'partially_paid', 'unfunded'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const LINE_STATUSES = ['pending', 'paid', 'unfunded', 'failed'] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];
export type RunKind = 'weekly' | 'exception';

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** The tenant's Main account (the funding source of every run line). */
export const tenantMain = (tenantId: string, currencyCode = 'INR'): AccountRef => ({ kind: 'tenant', tenantId, accountCode: TenantAccount.Main, currencyCode });

/** The wallet key of one run line: a function of WHICH run and WHICH ambassador — a re-run of the same line can never post twice. */
export const runLineKey = (runId: string, ambassadorId: string) => `ambrun:${runId}:${ambassadorId}`;

/** THE LEGS (and the only legs) a run line posts: tenant Main → ambassador Main. Never platform Fees. */
export function runLineLegs(tenantId: string, ambassadorUserId: string, amountMinor: bigint): LedgerLeg[] {
  if (amountMinor <= 0n) throw new Error('a run line pays a positive amount');
  return [{ account: tenantMain(tenantId), amountMinor: -amountMinor }, { account: userMain(ambassadorUserId), amountMinor }];
}

/** IST wall-clock parts of an instant. */
export function istParts(d: Date): { ymd: string; weekday: number; hour: number; minute: number } {
  const s = new Date(d.getTime() + IST_OFFSET_MS);
  return { ymd: s.toISOString().slice(0, 10), weekday: s.getUTCDay(), hour: s.getUTCHours(), minute: s.getUTCMinutes() };
}
/** The UTC instant of a given IST date + time. */
export function istInstant(ymd: string, hour: number, minute = 0): Date {
  return new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10), hour, minute) - IST_OFFSET_MS);
}
export function addDays(ymd: string, n: number): string {
  return new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The most recent Thursday 23:00 IST at or before `now` — a weekly run's period end. */
export function weeklyPeriodEnd(now: Date): Date {
  const p = istParts(now);
  const back = (p.weekday - 4 + 7) % 7;                     // days since Thursday (IST)
  let thursday = addDays(p.ymd, -back);
  if (back === 0 && p.hour < 23) thursday = addDays(thursday, -7);   // Thursday before 23:00 → last week's
  return istInstant(thursday, 23, 0);
}
/** May the Thursday job prepare now? Inside the 24 hours after a period end (a missed tick catches up; a day late it does not). */
export function inPrepareWindow(now: Date): boolean {
  const end = weeklyPeriodEnd(now);
  const since = now.getTime() - end.getTime();
  return since >= 0 && since < DAY_MS;
}
/** "Pays Friday": the first Friday strictly after the IST day of `from`. */
export function nextFriday(from: Date): string {
  const p = istParts(from);
  const ahead = ((5 - p.weekday + 7) % 7) || 7;
  return addDays(p.ymd, ahead);
}

/** The first day (YYYY-MM-01) of the latest month that has fully ENDED (in IST) at `periodEnd`. */
export function stipendMonthFor(periodEnd: Date): string {
  const p = istParts(periodEnd);
  const y = +p.ymd.slice(0, 4); const m = +p.ymd.slice(5, 7);
  const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, '0')}-01`;
}
/** [start, end) of a month as UTC instants of its IST midnights. */
export function monthBounds(monthFirst: string): { start: Date; end: Date } {
  const y = +monthFirst.slice(0, 4); const m = +monthFirst.slice(5, 7);
  const ny = m === 12 ? y + 1 : y; const nm = m === 12 ? 1 : m + 1;
  return { start: istInstant(monthFirst, 0, 0), end: istInstant(`${ny}-${String(nm).padStart(2, '0')}-01`, 0, 0) };
}

/** Was this ambassador an active ambassador for the WHOLE month? (pro-rata refused: enrolled after the month began → not yet). */
export function stipendDue(input: {
  monthlyStipendMinor: bigint; isActive: boolean; enrolledAt: Date; suspendedDuringMonth: boolean; alreadyPaid: boolean; monthFirst: string;
}): { due: boolean; reason: 'no_stipend' | 'inactive' | 'not_whole_month' | 'suspended_in_month' | 'already_paid' | null } {
  if (input.monthlyStipendMinor <= 0n) return { due: false, reason: 'no_stipend' };
  if (!input.isActive) return { due: false, reason: 'inactive' };
  if (input.enrolledAt.getTime() > monthBounds(input.monthFirst).start.getTime()) return { due: false, reason: 'not_whole_month' };
  if (input.suspendedDuringMonth) return { due: false, reason: 'suspended_in_month' };
  if (input.alreadyPaid) return { due: false, reason: 'already_paid' };
  return { due: true, reason: null };
}

export interface FundingCheck { mainBalanceMinor: string; totalMinor: string; covers: boolean; shortfallMinor: string; readAt: string }
/** The "Funding" line, from a REAL balance read (canon W161 "Funding: main available covers total"). */
export function fundingCheck(mainBalanceMinor: bigint, totalMinor: bigint, readAt: Date): FundingCheck {
  const short = totalMinor > mainBalanceMinor ? totalMinor - mainBalanceMinor : 0n;
  return { mainBalanceMinor: mainBalanceMinor.toString(), totalMinor: totalMinor.toString(), covers: short === 0n, shortfallMinor: short.toString(), readAt: readAt.toISOString() };
}

/** A run's status after a pay attempt, from its lines. */
export function runStatusAfterPay(lines: Array<{ status: LineStatus }>): 'paid' | 'partially_paid' | 'unfunded' {
  const paid = lines.filter((l) => l.status === 'paid').length;
  if (lines.length > 0 && paid === lines.length) return 'paid';
  if (paid === 0 && lines.some((l) => l.status === 'unfunded')) return 'unfunded';
  return 'partially_paid';
}
