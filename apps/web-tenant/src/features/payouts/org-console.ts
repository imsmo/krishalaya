// apps/web-tenant/src/features/payouts/org-console.ts · W145's queue and W146's approval as PURE rules
// (PC-56 TENANT-4b). No React, no I/O — unit- and mutation-tested, and the API re-enforces every one.

/** W145's five tabs. This list IS the partition of the six-state machine, and the screen prints a count of
 *  anything outside it rather than letting a status become invisible on the page that shows every payout. */
export const QUEUE_TABS = ['queued', 'processing', 'failed', 'success', 'reversed_cancelled'] as const;
export type QueueTab = (typeof QUEUE_TABS)[number];

export function tabFilter(v: string | undefined | null): QueueTab | null {
  return v && (QUEUE_TABS as readonly string[]).includes(v) ? (v as QueueTab) : null;
}

/** The lane word beside a row. `wage_not_promoted` is the honest one: a wage payout still sitting at default
 *  priority did NOT get the lane W145 promises, and printing "priority lane" over it would be a lie a worker
 *  pays for in days. */
export function laneKey(lane: string): 'wage' | 'standard' | 'wageNotPromoted' {
  if (lane === 'wage_priority') return 'wage';
  if (lane === 'wage_not_promoted') return 'wageNotPromoted';
  return 'standard';
}

/** W145: "Failures state the real reason and the exact retry time." Three different sentences, because
 *  "retrying" over an account the bank will reject forever is the cruellest copy on this screen. */
export type RetryPlanView =
  | { kind: 'at'; at: string; attempt: number }
  | { kind: 'needsHuman' }
  | { kind: 'exhausted'; attempts: number }
  | { kind: 'none' };

export function retryView(plan: { kind: string; at?: string; attempt?: number; attempts?: number } | null): RetryPlanView {
  if (!plan) return { kind: 'none' };
  if (plan.kind === 'retry_at' && plan.at) return { kind: 'at', at: plan.at, attempt: plan.attempt ?? 1 };
  if (plan.kind === 'needs_human') return { kind: 'needsHuman' };
  if (plan.kind === 'exhausted') return { kind: 'exhausted', attempts: plan.attempts ?? 0 };
  return { kind: 'none' };
}

export function retryKey(v: RetryPlanView): string {
  return `po.retry.${v.kind}`;
}

/** Is the Retry control offered on this row? Withheld rather than shown-and-refused: an operator who learns
 *  a button is decorative stops trusting the ones that work. */
export function retryBlockedBy(
  row: { status: string; retry: { kind: string } | null },
  perms: { canApprove: boolean },
): 'notFailed' | 'noPermission' | 'needsHuman' | 'exhausted' | null {
  if (row.status !== 'failed') return 'notFailed';
  if (!perms.canApprove) return 'noPermission';
  if (row.retry?.kind === 'needs_human') return 'needsHuman';
  if (row.retry?.kind === 'exhausted') return 'exhausted';
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * W146: the approval
 * ---------------------------------------------------------------------------------------------- */

export type PreflightState = 'pass' | 'fail' | 'unverifiable';

/** THE MARK BESIDE A CHECK. `unverifiable` must never render as a tick — W146 says "all must pass", and a
 *  check whose source does not exist has not passed; it has not run. (The risk desk does not exist at all.) */
export function preflightIcon(state: PreflightState): '✓' | '✕' | '?' {
  return state === 'pass' ? '✓' : state === 'fail' ? '✕' : '?';
}

export function preflightLabelKey(check: string): string { return `po.pre.${check}`; }

/** Only a FAILED check blocks — otherwise the missing risk desk would stop every payout on the platform,
 *  which is a worse failure than naming the gap. The screen shows both, differently. */
export function preflightBlocks(lines: ReadonlyArray<{ state: PreflightState }>): boolean {
  return lines.some((l) => l.state === 'fail');
}

export function unverifiableCount(lines: ReadonlyArray<{ state: PreflightState }>): number {
  return lines.filter((l) => l.state === 'unverifiable').length;
}

/** What stands between this batch and the money moving, in one word — and the ORDER is the order the API
 *  refuses in, so the screen's reason and the server's reason can never disagree. */
export type ApproveBlock = 'notPending' | 'locked' | 'youPrepared' | 'preflightFailed' | 'noPermission';

export function approveBlockedBy(
  v: {
    status: string; window: string; viewerIsMaker: boolean; needsChecker: boolean;
    preflight: { lines: ReadonlyArray<{ state: PreflightState }> };
  },
  perms: { canApprove: boolean },
): ApproveBlock | null {
  if (v.status !== 'pending_approval') return 'notPending';
  if (v.window !== 'open_for_approval') return 'locked';
  if (!perms.canApprove) return 'noPermission';
  // Below the tenant's threshold the maker may sign their own batch; at or above it, they may not.
  if (v.needsChecker && v.viewerIsMaker) return 'youPrepared';
  if (preflightBlocks(v.preflight.lines)) return 'preflightFailed';
  return null;
}

/** Rejecting does NOT require the pre-flight to pass — refusing a batch that failed its checks is precisely
 *  what a checker is for. It does require the reason, and the window. */
export function rejectBlockedBy(
  v: { status: string; window: string },
  perms: { canApprove: boolean },
): 'notPending' | 'locked' | 'noPermission' | null {
  if (v.status !== 'pending_approval') return 'notPending';
  if (v.window !== 'open_for_approval') return 'locked';
  if (!perms.canApprove) return 'noPermission';
  return null;
}

export const NOTE_FLOOR = 20;
export function isNoteLongEnough(note: string | undefined | null): boolean {
  return (note ?? '').trim().length >= NOTE_FLOOR;
}

/** The sentence under the Approve button: which rule is actually in force for THIS batch. A screen that said
 *  "maker-checker" over a batch below the tenant's threshold would be describing a control that did not run. */
export function checkerRuleKey(needsChecker: boolean): 'po.rule.twoHumans' | 'po.rule.singleSigner' {
  return needsChecker ? 'po.rule.twoHumans' : 'po.rule.singleSigner';
}

/** W146's clock line. `locked` is the state the canon describes as rolling to tomorrow. */
export function windowKey(window: string): string {
  return `po.window.${window === 'open_for_approval' ? 'open' : window === 'locked' ? 'locked' : 'due'}`;
}

/** The earliest execution instant a maker may submit: now + the cut-off, or the batch can never be signed.
 *  Returned as the value an `<input type="datetime-local">` carries, in the browser's own zone — the backend
 *  is given an instant WITH an offset and never guesses a local 18:00 (Rule Zero: five countries by Y7). */
export function earliestExecuteLocal(now: Date, cutOffMinutes = 30): string {
  const t = new Date(now.getTime() + (cutOffMinutes + 1) * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:${p(t.getMinutes())}`;
}

export function isAllowedExecuteAt(value: string, now: Date, cutOffMinutes = 30): boolean {
  const t = Date.parse(value);
  if (Number.isNaN(t)) return false;
  return t - now.getTime() > cutOffMinutes * 60_000;
}

/** Every refusal the API can return here, translated BY NAME. A payout run that fails with "something went
 *  wrong" gets pressed again against the same 42 farmers. */
export const REFUSALS: Record<string, string> = {
  PAYOUT_BATCH_ALREADY_PENDING: 'alreadyPending',
  PAYOUT_BATCH_NOT_PENDING: 'notPending',
  PAYOUT_BATCH_LOCKED: 'locked',
  PAYOUT_BATCH_CHECKER_IS_MAKER: 'checkerIsMaker',
  PAYOUT_BATCH_NOTE_TOO_SHORT: 'noteShort',
  PAYOUT_BATCH_PREFLIGHT_FAILED: 'preflightFailed',
  PAYOUT_BATCH_WINDOW_TOO_SOON: 'windowTooSoon',
  PAYOUT_BATCH_EXECUTE_AT_INVALID: 'executeAtInvalid',
  PAYOUT_BATCH_NOT_FOUND: 'notFound',
  PAYOUT_NOT_FAILED: 'notFailed',
  PAYOUT_RETRY_NEEDS_HUMAN: 'retryNeedsHuman',
  PAYOUT_RETRY_EXHAUSTED: 'retryExhausted',
  PAYOUT_NOT_FOUND: 'notFound',
};

export function refusalKey(code: string): string {
  return `po.err.${REFUSALS[code] ?? 'generic'}`;
}

/** W145's four KPI cards, from the counts the API returns. `null` where the figure cannot be derived — this
 *  screen has no place for a plausible number. */
export function kpiCount(counts: Record<string, number>, tab: QueueTab): number {
  const map: Record<QueueTab, string[]> = {
    queued: ['queued'], processing: ['processing'], failed: ['failed'],
    success: ['success'], reversed_cancelled: ['reversed', 'cancelled'],
  };
  return map[tab].reduce((n, s) => n + (counts[s] ?? 0), 0);
}
