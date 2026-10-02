// modules/labour/domain/labour-money.ts · PC-56 TENANT-11b · F-5 / A2–A4 — WHAT A LABOUR JOB COSTS AND WHAT A WORKER IS OWED. PURE.
//
// Founder decision (2026-10-02): wages are ESCROWED AT ROSTER CONFIRM, plus a flat ₹20 platform fee; the same-day fairness fee
// is refused by name. Before this wave `payWages` posted ONE `wageMinor` per accepted worker whatever the dates, hours or
// attendance (a 3-day ₹420/day job paid ₹420; a no-show was paid the same). Every amount below is integer minor units
// (bigint); hours arrive as numeric(4,2) and are carried as integer HUNDREDTHS so no float ever touches money.
//
//   ESCROW (roster confirm)   expected = Σ accepted assignments × planned units × that assignment's rate
//                               planned units: per_day = days (start..end inclusive); per_hour = days × daily_hours;
//                               per_task = 1.   fee = the active labour_fee_rules row (flat; cap not set).
//   WAGE (pay run, per assignment, over CONFIRMED attendance not yet paid)
//     per_day   base = confirmed days × rate                     OT = OT hours × (rate ÷ daily_hours) × multiplier
//     per_hour  base = regular hours × rate                      OT = OT hours × rate × multiplier
//     per_task  base = rate ONCE, when the booking is completed  OT not priced (a task has no hourly base) — said
//   Rounding: half-up to the paisa, once per amount (never per day), so a 3-day job is rate × 3 exactly.
//
// IDEMPOTENCY KEYS (Law 3) — the ledger refuses a second post under the same key:
//   labour-escrow:<booking>   labour-escrow-topup:<booking>:<n>   labour-escrow-release:<booking>
//   wage:<assignment>:<sha256(sorted confirmed attendance ids)>   wage-ot:<assignment>:<same sha>
// The wage key covers EXACTLY the attendance it pays, so a day confirmed later is a new key in a later run, and a run over
// the same days is the same key — a second run moves nothing.
import { createHash } from 'node:crypto';
import { AccountRef, PlatformAccount, platform, userHold, userMain } from '../../../core/wallet/account-codes';
import { LedgerLeg } from '../../../core/wallet/wallet.port';
import { WageKind } from './labour.events';

export const LABOUR_TXN = {
  Escrow: 'labour_escrow', Topup: 'labour_escrow_topup', Release: 'labour_escrow_release', Wage: 'wage_payout',
} as const;
export const LABOUR_REFERENCE_TYPE = 'labour_booking';

/** Half-up integer division for non-negative numerators (money is never negative here). */
export function divRoundHalfUp(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new Error('divRoundHalfUp: non-positive divisor');
  if (n < 0n) throw new Error('divRoundHalfUp: negative numerator');
  return (n * 2n + d) / (2n * d);
}

/** numeric(4,2) / numeric(3,2) → integer hundredths. Accepts number or numeric text; never a float in the money math. */
export function hundredths(v: number | string | null | undefined): bigint {
  if (v === null || v === undefined || v === '') return 0n;
  const s = String(v).trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) return BigInt(Math.round(Number(v) * 100));
  const frac = (m[3] ?? '').padEnd(2, '0');
  const cents = BigInt(m[2]) * 100n + BigInt(frac.slice(0, 2)) + (frac.length > 2 && Number(frac[2]) >= 5 ? 1n : 0n);
  return m[1] === '-' ? -cents : cents;
}

/** Calendar days start..end inclusive, from YYYY-MM-DD strings (UTC arithmetic on dates — no time zone involved). */
export function plannedDays(startDate: string, endDate: string): number {
  const a = Date.UTC(+startDate.slice(0, 4), +startDate.slice(5, 7) - 1, +startDate.slice(8, 10));
  const b = Date.UTC(+endDate.slice(0, 4), +endDate.slice(5, 7) - 1, +endDate.slice(8, 10));
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

/** Planned units per worker, in hundredths (per_day days, per_hour hours, per_task 1). */
export function plannedUnitsHundredths(kind: WageKind, days: number, dailyHours: number | string): bigint {
  if (kind === 'per_day') return BigInt(days) * 100n;
  if (kind === 'per_hour') return BigInt(days) * hundredths(dailyHours);
  return 100n;
}

/** One assignment's share of the escrow: planned units × rate. */
export function expectedForAssignment(kind: WageKind, rateMinor: bigint, days: number, dailyHours: number | string): bigint {
  return divRoundHalfUp(plannedUnitsHundredths(kind, days, dailyHours) * rateMinor, 100n);
}

export interface FeeRule { id: string | null; kind: 'flat_per_booking'; amountMinor: bigint; capMinor: bigint | null; capRuleNote: string }
/** The platform fee for one booking. The cap, when the founder sets one, bounds the fee; today it is NULL ("not set"). */
export function feeFor(rule: FeeRule | null): bigint {
  if (!rule) return 0n;
  const fee = rule.amountMinor;
  return rule.capMinor !== null && fee > rule.capMinor ? rule.capMinor : fee;
}

export interface EscrowEstimate { perWorkerMinor: bigint[]; wagesMinor: bigint; feeMinor: bigint; totalMinor: bigint; days: number; units: string }
export function escrowEstimate(input: { kind: WageKind; startDate: string; endDate: string; dailyHours: number | string; rates: bigint[]; fee: FeeRule | null }): EscrowEstimate {
  const days = plannedDays(input.startDate, input.endDate);
  const perWorkerMinor = input.rates.map((r) => expectedForAssignment(input.kind, r, days, input.dailyHours));
  const wagesMinor = perWorkerMinor.reduce((s, x) => s + x, 0n);
  const feeMinor = input.rates.length > 0 ? feeFor(input.fee) : 0n;
  const u = plannedUnitsHundredths(input.kind, days, input.dailyHours);
  return { perWorkerMinor, wagesMinor, feeMinor, totalMinor: wagesMinor + feeMinor, days, units: `${u / 100n}.${String(u % 100n).padStart(2, '0')}` };
}

/** A confirmed attendance day as the wage reads it. */
export interface ConfirmedDay { id: string; hoursRegular: number | string | null; hoursOvertime: number | string | null }

export interface WageComputation {
  daysConfirmed: number; hoursRegularH: bigint; hoursOvertimeH: bigint;
  baseMinor: bigint; otMinor: bigint;
  otStatus: 'none' | 'not_priced' | 'due';
  zeroReason: 'no_confirmed_attendance' | 'task_paid_once' | null;
  /** per_task before completion: the days are confirmed but the task is paid on completion — do not stamp, do not pay. */
  deferred: boolean;
}

/** THE WAGE. Pure: the rule above, on the confirmed days handed in. */
export function computeWage(input: {
  kind: WageKind; rateMinor: bigint; dailyHours: number | string; overtimeMultiplier: number | string;
  days: ConfirmedDay[]; bookingCompleted: boolean; taskPaidBefore: boolean;
}): WageComputation {
  const reg = input.days.reduce((s, d) => s + hundredths(d.hoursRegular), 0n);
  const ot = input.days.reduce((s, d) => s + hundredths(d.hoursOvertime), 0n);
  const mult = hundredths(input.overtimeMultiplier);
  const base: WageComputation = { daysConfirmed: input.days.length, hoursRegularH: reg, hoursOvertimeH: ot, baseMinor: 0n, otMinor: 0n, otStatus: 'none', zeroReason: null, deferred: false };
  if (input.days.length === 0) return { ...base, zeroReason: 'no_confirmed_attendance' };
  if (input.kind === 'per_day') {
    const dh = hundredths(input.dailyHours);
    const otMinor = ot > 0n && dh > 0n ? divRoundHalfUp(ot * input.rateMinor * mult, dh * 100n) : 0n;
    return { ...base, baseMinor: BigInt(input.days.length) * input.rateMinor, otMinor, otStatus: otMinor > 0n ? 'due' : 'none' };
  }
  if (input.kind === 'per_hour') {
    const otMinor = ot > 0n ? divRoundHalfUp(ot * input.rateMinor * mult, 10_000n) : 0n;
    return { ...base, baseMinor: divRoundHalfUp(reg * input.rateMinor, 100n), otMinor, otStatus: otMinor > 0n ? 'due' : 'none' };
  }
  // per_task
  if (!input.bookingCompleted) return { ...base, deferred: true };
  if (input.taskPaidBefore) return { ...base, zeroReason: 'task_paid_once', otStatus: ot > 0n ? 'not_priced' : 'none' };
  return { ...base, baseMinor: input.rateMinor, otStatus: ot > 0n ? 'not_priced' : 'none' };
}

/** sha256 of the sorted attendance ids a run covers — the run key (and the ledger key's tail). */
export function runKeyOf(attendanceIds: readonly string[]): string {
  return createHash('sha256').update([...attendanceIds].sort().join(',')).digest('hex');
}

export const escrowKey = (bookingId: string) => `labour-escrow:${bookingId}`;
export const topupKey = (bookingId: string, n: number) => `labour-escrow-topup:${bookingId}:${n}`;
export const releaseKey = (bookingId: string) => `labour-escrow-release:${bookingId}`;
export const wageKey = (assignmentId: string, runKey: string) => `wage:${assignmentId}:${runKey}`;
export const wageOtKey = (assignmentId: string, runKey: string) => `wage-ot:${assignmentId}:${runKey}`;

export function escrowLegs(employerUserId: string, wagesMinor: bigint, feeMinor: bigint): LedgerLeg[] {
  const legs: LedgerLeg[] = [
    { account: userMain(employerUserId), amountMinor: -(wagesMinor + feeMinor) },
    { account: userHold(employerUserId), amountMinor: wagesMinor },
  ];
  if (feeMinor > 0n) legs.push({ account: platform(PlatformAccount.Fees), amountMinor: feeMinor });
  return legs;
}
export function topupLegs(employerUserId: string, amountMinor: bigint): LedgerLeg[] {
  return [{ account: userMain(employerUserId), amountMinor: -amountMinor }, { account: userHold(employerUserId), amountMinor }];
}
export function releaseLegs(employerUserId: string, amountMinor: bigint): LedgerLeg[] {
  return [{ account: userHold(employerUserId), amountMinor: -amountMinor }, { account: userMain(employerUserId), amountMinor }];
}
/** A wage leg pair. Source: the escrow (employer Hold) — or, for a booking started before 0187 with no escrow, employer Main. */
export function wageLegs(source: AccountRef, workerUserId: string, amountMinor: bigint): LedgerLeg[] {
  return [{ account: source, amountMinor: -amountMinor }, { account: userMain(workerUserId), amountMinor }];
}

/** What the escrow still holds for this booking. */
export function heldMinor(e: { expectedMinor: bigint; toppedUpMinor: bigint; paidMinor: bigint; releasedMinor: bigint }): bigint {
  return e.expectedMinor + e.toppedUpMinor - e.paidMinor - e.releasedMinor;
}
