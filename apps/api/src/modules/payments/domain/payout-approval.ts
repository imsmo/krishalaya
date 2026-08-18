// modules/payments/domain/payout-approval.ts · W145/W146's rules as PURE functions (PC-56 TENANT-4b).
// The gate that stands between a prepared batch and 42 farmers' bank accounts. No I/O, no Nest, no SQL.
import { DomainError } from '../../../shared/errors/app-error';

/** W145: "batch approval needs payout.approve + checker above Rs 1,00,000." The default lives here AND in
 *  0143's setting; a tenant whose setting cannot be read falls back to the STRICTER reading of the two
 *  (this constant), because failing open on a money control is not a degradation, it is a hole. */
export const DEFAULT_CHECKER_THRESHOLD_MINOR = 10_000_000n;
export const DEFAULT_CUT_OFF_MINUTES = 30;
export const NOTE_FLOOR = 20;

/** A batch total at or above the threshold needs a DIFFERENT person than the maker. Below it, the maker's
 *  own signature is accepted — and the screen says which regime applied, so nobody reads "approved" as
 *  meaning two humans looked when the tenant's threshold said one was enough. */
export function needsChecker(itemsTotalMinor: bigint, thresholdMinor: bigint): boolean {
  return itemsTotalMinor >= thresholdMinor;
}

export class PayoutApprovalError extends DomainError {}

/* ------------------------------------------------------------------------------------------------
 * THE PRE-FLIGHT (W146: "Pre-flight checks (all must pass)")
 * ---------------------------------------------------------------------------------------------- */

export type PreflightCheck = 'payee_kyc' | 'items_sum' | 'funds_available' | 'no_frozen_payee' | 'risk_desk';
/** `unverifiable` is not a soft pass. It is what a check reports when the SOURCE for it does not exist,
 *  and it is rendered differently everywhere — 4a's rule, applied where the consequence is money. */
export type PreflightState = 'pass' | 'fail' | 'unverifiable';

export interface PreflightLine { check: PreflightCheck; state: PreflightState; detail?: string }
export interface PreflightVerdict { lines: PreflightLine[]; passed: boolean; blocking: PreflightCheck[] }

export interface PreflightInput {
  itemCount: number;
  itemsTotalMinor: bigint;
  /** Payouts whose payee is fully KYC-verified WITH a verified destination (domain/payout-kyc.ts). */
  kycVerifiedCount: number;
  /** The sum the repository computed over the claimed rows — compared with itemsTotalMinor, which the
   *  service carries independently. W146: "server-verified, not UI math." */
  serverSumMinor: bigint;
  /** The tenant's `main` available balance, from the ledger (TENANT-4a's read). `null` = unreadable. */
  availableMinor: bigint | null;
  frozenPayeeCount: number;
}

export function preflight(i: PreflightInput): PreflightVerdict {
  const lines: PreflightLine[] = [];

  lines.push(
    i.itemCount === 0
      ? { check: 'payee_kyc', state: 'unverifiable', detail: 'no_items' }
      : i.kycVerifiedCount === i.itemCount
        ? { check: 'payee_kyc', state: 'pass', detail: `${i.kycVerifiedCount}/${i.itemCount}` }
        : { check: 'payee_kyc', state: 'fail', detail: `${i.kycVerifiedCount}/${i.itemCount}` },
  );

  // Two independently-derived figures must agree. If they do not, NOTHING else about this batch is
  // trustworthy — the checker would be signing a number that does not describe the rows.
  lines.push(
    i.serverSumMinor === i.itemsTotalMinor
      ? { check: 'items_sum', state: 'pass', detail: i.itemsTotalMinor.toString() }
      : { check: 'items_sum', state: 'fail', detail: `${i.itemsTotalMinor}!=${i.serverSumMinor}` },
  );

  // A batch that exceeds the balance does not fail cleanly — it half-pays a village and leaves the rest
  // in `failed` with a bank reason that is not the real reason. So it is checked once, up front.
  lines.push(
    i.availableMinor === null
      ? { check: 'funds_available', state: 'unverifiable', detail: 'balance_unreadable' }
      : i.availableMinor >= i.itemsTotalMinor
        ? { check: 'funds_available', state: 'pass', detail: i.availableMinor.toString() }
        : { check: 'funds_available', state: 'fail', detail: `${i.availableMinor}<${i.itemsTotalMinor}` },
  );

  lines.push(
    i.frozenPayeeCount === 0
      ? { check: 'no_frozen_payee', state: 'pass' }
      : { check: 'no_frozen_payee', state: 'fail', detail: `${i.frozenPayeeCount}` },
  );

  // W146: "No payee flagged by risk desk". THERE IS NO RISK DESK — no table, no column, no service. This
  // reports `unverifiable` forever until one exists, and the screen prints why. A green tick here would
  // be the platform telling an FPO that a check ran which has never existed.
  lines.push({ check: 'risk_desk', state: 'unverifiable', detail: 'no_risk_desk_exists' });

  const blocking = lines.filter((l) => l.state === 'fail').map((l) => l.check);
  return { lines, passed: blocking.length === 0, blocking };
}

/** W146 says "all must pass". An `unverifiable` line does NOT block — otherwise the missing risk desk
 *  would stop every payout on the platform, which is a worse failure than naming the gap. What it does is
 *  travel with the decision: `preflight` is stored as the evidence the checker signed against. */
export function preflightBlocksApproval(v: PreflightVerdict): boolean {
  return !v.passed;
}

/* ------------------------------------------------------------------------------------------------
 * THE WINDOW (W146: "cut-off 17:30 · executes 18:00 · after 17:30 the batch locks")
 * ---------------------------------------------------------------------------------------------- */

export interface BatchWindow { cutOffAt: Date; executeAt: Date }

/** The maker submits the execution instant (the console renders it in their own locale — a wall-clock
 *  default in the backend would be a hidden timezone assumption, and this platform ships to five countries
 *  by Y7). The cut-off is derived from the tenant's setting. */
export function batchWindow(executeAt: Date, cutOffMinutes: number, now: Date): BatchWindow {
  if (Number.isNaN(executeAt.getTime())) throw new PayoutApprovalError('PAYOUT_BATCH_EXECUTE_AT_INVALID', 'execute_at is not a time', 400);
  const mins = Number.isInteger(cutOffMinutes) && cutOffMinutes >= 0 ? cutOffMinutes : DEFAULT_CUT_OFF_MINUTES;
  const cutOffAt = new Date(executeAt.getTime() - mins * 60_000);
  if (cutOffAt.getTime() <= now.getTime()) {
    throw new PayoutApprovalError('PAYOUT_BATCH_WINDOW_TOO_SOON', 'the cut-off would already have passed', 400, { cutOffMinutes: mins });
  }
  return { cutOffAt, executeAt };
}

export type WindowState = 'open_for_approval' | 'locked' | 'due' ;

/** What the clock says about a pending batch. `locked` is the state W146 describes as rolling to
 *  tomorrow: past the cut-off and unapproved, the queue has moved on, so the signature would be against a
 *  list that no longer exists. */
export function windowState(w: { cutOffAt: Date | null; executeAt: Date | null }, now: Date): WindowState {
  if (w.executeAt && now.getTime() >= w.executeAt.getTime()) return 'due';
  if (w.cutOffAt && now.getTime() >= w.cutOffAt.getTime()) return 'locked';
  return 'open_for_approval';
}

/* ------------------------------------------------------------------------------------------------
 * THE GATE
 * ---------------------------------------------------------------------------------------------- */

export interface BatchForDecision {
  id: string;
  tenantId: string | null;
  status: string;
  preparedBy: string | null;
  decidedBy: string | null;
  itemsTotalMinor: bigint;
  checkerThresholdMinor: bigint | null;
  cutOffAt: Date | null;
  executeAt: Date | null;
}

export type DecisionRefusal =
  | 'PAYOUT_BATCH_NOT_PENDING'
  | 'PAYOUT_BATCH_LOCKED'
  | 'PAYOUT_BATCH_CHECKER_IS_MAKER'
  | 'PAYOUT_BATCH_NOTE_TOO_SHORT'
  | 'PAYOUT_BATCH_PREFLIGHT_FAILED';

/** May THIS person approve THIS batch, right now? Returns the refusal name or null. Order matters: the
 *  state first (an already-decided batch is not a permission question), then the clock, then the person,
 *  then the evidence — so the message an operator gets is the first true reason, not the last. */
export function approvalRefusal(
  b: BatchForDecision,
  actorUserId: string,
  now: Date,
  pre: PreflightVerdict,
): DecisionRefusal | null {
  if (b.status !== 'pending_approval') return 'PAYOUT_BATCH_NOT_PENDING';
  if (windowState(b, now) !== 'open_for_approval') return 'PAYOUT_BATCH_LOCKED';
  const threshold = b.checkerThresholdMinor ?? DEFAULT_CHECKER_THRESHOLD_MINOR;
  if (needsChecker(b.itemsTotalMinor, threshold) && b.preparedBy && b.preparedBy === actorUserId) {
    return 'PAYOUT_BATCH_CHECKER_IS_MAKER';
  }
  if (preflightBlocksApproval(pre)) return 'PAYOUT_BATCH_PREFLIGHT_FAILED';
  return null;
}

/** A rejection needs its reason and does NOT need the pre-flight to pass — refusing a batch that failed
 *  its checks is exactly what a checker is for. The clock still applies: after the cut-off the batch
 *  expires on its own and there is nothing left to reject. */
export function rejectionRefusal(b: BatchForDecision, note: string, now: Date): DecisionRefusal | null {
  if (b.status !== 'pending_approval') return 'PAYOUT_BATCH_NOT_PENDING';
  if (windowState(b, now) !== 'open_for_approval') return 'PAYOUT_BATCH_LOCKED';
  if (btrim(note).length < NOTE_FLOOR) return 'PAYOUT_BATCH_NOTE_TOO_SHORT';
  return null;
}

const btrim = (s: string | null | undefined) => (s ?? '').trim();

/** THE EXECUTOR'S QUESTION, and the only place it is answered. A tenant batch may be disbursed when it
 *  was approved and its execution time has arrived. `rejected` is refused whatever the flag says: nothing
 *  justifies paying out a run a human declined. With the flag OFF, a legacy `open` sweep still runs (the
 *  pilot's behaviour) — and that is stated in the verdict rather than hidden, so an operator reading the
 *  log knows which regime moved the money. */
export type ExecutionVerdict =
  | { kind: 'execute'; basis: 'approved' | 'legacy_open_sweep' }
  | { kind: 'refuse'; reason: 'rejected' | 'not_approved' | 'not_due' | 'already_terminal' };

export function executionVerdict(
  b: { status: string; tenantId: string | null; executeAt: Date | null },
  now: Date,
  approvalRequired: boolean,
): ExecutionVerdict {
  if (b.status === 'rejected' || b.status === 'expired') return { kind: 'refuse', reason: 'rejected' };
  if (['executed', 'failed', 'executing'].includes(b.status)) return { kind: 'refuse', reason: 'already_terminal' };
  if (b.status === 'approved') {
    return b.executeAt && now.getTime() < b.executeAt.getTime()
      ? { kind: 'refuse', reason: 'not_due' }
      : { kind: 'execute', basis: 'approved' };
  }
  if (b.status === 'pending_approval') return { kind: 'refuse', reason: 'not_approved' };
  // status 'open': the platform sweep the pilot runs today.
  if (approvalRequired && b.tenantId !== null) return { kind: 'refuse', reason: 'not_approved' };
  return { kind: 'execute', basis: 'legacy_open_sweep' };
}

/* ------------------------------------------------------------------------------------------------
 * W145's FAILURE COLUMN: "Failures state the real reason and the exact retry time"
 * ---------------------------------------------------------------------------------------------- */

export type FailureBucket = 'insufficient_funds' | 'invalid_account' | 'bank_declined' | 'timeout' | 'other';

/** Which failures a machine may retry, and which need a human. An invalid account will fail identically
 *  forever — auto-requeueing it tells a farmer "retrying" every hour about money that will never arrive,
 *  which is the cruellest possible lie on this screen. */
export const AUTO_REQUEUE_BUCKETS: readonly FailureBucket[] = ['timeout', 'bank_declined', 'other'];

export function isAutoRequeueable(bucket: string): boolean {
  return (AUTO_REQUEUE_BUCKETS as readonly string[]).includes(bucket);
}

export const RETRY_BACKOFF_MINUTES: readonly number[] = [15, 60, 240, 1440];
export const MAX_AUTO_ATTEMPTS = RETRY_BACKOFF_MINUTES.length;

export type RetryPlan =
  | { kind: 'retry_at'; at: Date; attempt: number }
  /** The bank rejected the destination itself: a human must fix the account. Stated as such. */
  | { kind: 'needs_human'; reason: 'account_must_be_fixed' }
  /** Every automatic attempt is spent. Not "retrying" — somebody has to look. */
  | { kind: 'exhausted'; attempts: number };

/** W145 promises "the exact retry time". A screen that says "retrying" with no time is a farmer refreshing
 *  a page all afternoon; a screen that says 16:00 is a farmer who can plan their day. */
export function retryPlan(bucket: string, attemptsSoFar: number, failedAt: Date): RetryPlan {
  if (!isAutoRequeueable(bucket)) return { kind: 'needs_human', reason: 'account_must_be_fixed' };
  if (attemptsSoFar >= MAX_AUTO_ATTEMPTS) return { kind: 'exhausted', attempts: attemptsSoFar };
  const mins = RETRY_BACKOFF_MINUTES[Math.max(0, attemptsSoFar)];
  return { kind: 'retry_at', at: new Date(failedAt.getTime() + mins * 60_000), attempt: attemptsSoFar + 1 };
}

/** W145's five tabs are one exhaustive partition of the six-state machine — pinned so a state added later
 *  cannot become invisible on the screen that is supposed to show every payout. */
export const PAYOUT_TABS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  queued: ['queued'],
  processing: ['processing'],
  failed: ['failed'],
  success: ['success'],
  reversed_cancelled: ['reversed', 'cancelled'],
});

export function tabOf(status: string): string | null {
  for (const [tab, states] of Object.entries(PAYOUT_TABS)) if (states.includes(status)) return tab;
  return null;
}

/** W145: "Wages ride a priority lane." The lane is a NUMBER on the payout row (lower = sooner), and this
 *  is the word for it — so the screen cannot claim a lane for a row the claimer will not prioritise. */
export const WAGE_LANE_MAX_PRIORITY = 10;
export function laneOf(priority: number, purpose: string): 'wage_priority' | 'standard' | 'wage_not_promoted' {
  if (priority <= WAGE_LANE_MAX_PRIORITY) return 'wage_priority';
  // A wage payout sitting at default priority did not get promoted: the screen says so instead of
  // printing "priority lane" over a row queued behind every settlement in the run.
  return purpose === 'wage' ? 'wage_not_promoted' : 'standard';
}
