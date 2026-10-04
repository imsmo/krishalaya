// modules/labour/domain/wage-run.ts · PC-56 TENANT-SW-b · C1 — THE DAILY 18:00 IST WAGE RUN, AS ARITHMETIC. PURE.
//
// Founder decision (2026-10-03): a DAILY 18:00 IST wage run. Every confirmed-but-unpaid day across every booking is paid through 11b's pay
// run (escrow Hold → worker Main, wage:<assignment>:<sha256(days)>). A line whose booking's pay transaction failed RETRIES at 16:00 IST on
// the following day — one retry a day, three days — and is then named `failed` (RETRY_LADDER_EXHAUSTED).
//
// "Daily 18:00 with the settlement batch" (W166): the payments batch has NO cron in this codebase — W146's "executes 18:00" is the
// execute_at the payout maker submits, disbursed by the 5-minute PayoutExecutionCadenceJob. This run takes the same wall-clock instant,
// 18:00 Asia/Kolkata, as its own gate (checked every 5 minutes; once per IST day by `labour_wage_runs` UNIQUE (tenant, run_date)).
export const WAGE_RUN_HOUR_IST = 18;
export const WAGE_RETRY_HOUR_IST = 16;
/** One initial attempt + three daily retries. The fourth failure names the line `failed`. */
export const WAGE_MAX_ATTEMPTS = 4;
export const WAGE_LINE_STATUSES = ['paid', 'retrying', 'failed', 'skipped_unfunded'] as const;
export type WageLineStatus = (typeof WAGE_LINE_STATUSES)[number];

const IST_OFFSET_MS = 330 * 60_000;
export function istYmd(d: Date): string { return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10); }
export function istHour(d: Date): number { return new Date(d.getTime() + IST_OFFSET_MS).getUTCHours(); }
export function istAt(ymd: string, hour: number): Date {
  return new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10), hour, 0) - IST_OFFSET_MS);
}
export function addIstDays(ymd: string, n: number): string {
  return new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) + n * 86_400_000).toISOString().slice(0, 10);
}
/** Is the day's run due? From 18:00 IST until midnight; the run date is the IST day. */
export function dailyRunDue(now: Date): { due: boolean; runDate: string } {
  return { due: istHour(now) >= WAGE_RUN_HOUR_IST, runDate: istYmd(now) };
}
/** The next retry of a line that failed at `failedAt`: 16:00 IST on the following IST day. */
export function nextRetryAt(failedAt: Date): Date { return istAt(addIstDays(istYmd(failedAt), 1), WAGE_RETRY_HOUR_IST); }

/** A pay-run line (labour-money PayRunLine.status) → the wage run line status, or null when the line paid nothing and owes nothing. */
export function lineStatusFrom(payStatus: string, paidThisRunMinor: bigint): 'paid' | 'skipped_unfunded' | null {
  if (payStatus === 'awaiting_topup' || payStatus === 'partial') return paidThisRunMinor > 0n ? 'paid' : 'skipped_unfunded';
  if (payStatus === 'paid') return 'paid';
  return null;   // zero / nothing_new / task_on_completion: nothing to pay today — not a wage line
}
/** A run's status from its lines. No lines = nothing was due today = `paid` (the canon's "Nothing queued"). */
export function runStatusFrom(lines: Array<{ status: WageLineStatus }>): 'paid' | 'partially_paid' | 'failed' {
  if (lines.every((l) => l.status === 'paid')) return 'paid';
  if (lines.some((l) => l.status === 'paid')) return 'partially_paid';
  if (lines.every((l) => l.status === 'failed')) return 'failed';
  return 'partially_paid';
}
