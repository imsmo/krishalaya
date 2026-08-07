// apps/admin-api/src/modules/cells-ops/domain/migration-pipeline.ts · W034 (DELTA-012), PURE (PC-56 ADMIN-8b).
//
// W034's banner: "the move executes as a background job pipeline (copy → verify → cutover → cleanup) recorded as
// cell_map_changes action=moved; a dedicated migration_jobs table/state machine is not yet in schema. Design leads."
//
// ---------------------------------------------------------------------------
// DESIGNED AND NOT RUNNING, AND THE CONSOLE SAYS SO
// ---------------------------------------------------------------------------
// This module is the state machine, the preflight and the evidence rules. **There is no executor.** The worker that
// performs logical replication, runs the verify and takes the write freeze is ADMIN-8b-Q1.
//
// That is stated everywhere it could be mistaken, because this platform has now found FIVE status columns recording acts
// nobody performs (ADMIN-5's erasure, 5c's breach, 5f's removal, 0114's payout approval, 0116's shard weight) and a
// seven-state pipeline with no machine behind it would be the sixth and largest. ADMIN-7 made the same call about
// W088's auto-rollback and reported it as "armed by policy and by no running code"; this is the same sentence about a
// bigger object.
import { InvalidCellsInputError } from './cells-ops.errors';

export const JOB_STATUSES = ['queued', 'copying', 'verifying', 'cutover', 'done', 'rolled_back', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** THE TRANSITIONS, and every one of them is a moment W034 names.
 *
 *  `verifying → rolled_back` and `cutover → rolled_back` are both present because W034 says "automatic if verify fails —
 *  source stays authoritative until cutover commits": the safety net covers both sides of the commit point, and modelling
 *  only the first would leave a failed cutover with nowhere legal to go.
 *
 *  `done` IS TERMINAL EVEN THOUGH CLEANUP FOLLOWS IT. The 7-day safety hold and the source cleanup happen AFTER the
 *  migration is complete — the tenant is already served from the target. Making cleanup a state would mean a tenant's
 *  move showing as unfinished for a week, and an operator chasing a job that is doing exactly what it should.
 */
const TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = Object.freeze({
  queued: ['copying', 'failed'],
  copying: ['verifying', 'rolled_back', 'failed'],
  verifying: ['cutover', 'rolled_back'],
  cutover: ['done', 'rolled_back'],
  done: [],
  rolled_back: [],
  failed: [],
});

export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS as Record<string, readonly string[] | undefined>)[from]?.includes(to) ?? false;
}

export function assertTransition(from: string, to: string): void {
  if (!canTransition(from, to)) {
    throw new InvalidCellsInputError(
      `a migration cannot move from '${from}' to '${to}'. The pipeline is copy → verify → cutover → done, with a rollback `
      + 'available from copying, verifying and cutover — because the source stays authoritative until cutover commits.');
  }
}

/** After which states has the tenant's data already moved?
 *
 *  ONLY `done`. The point of the design is that the source is authoritative through copy and verify, and the placement
 *  row flips inside the cutover — so a job in ANY other state, including `rolled_back` after a failed cutover, leaves the
 *  tenant where they were. Exported because a console that got this wrong would tell somebody their data is in the wrong
 *  country.
 */
export function dataHasMoved(status: string): boolean { return status === 'done'; }

/** Is the source still needed? True until the safety hold expires and cleanup runs — which is why `done` is not the end
 *  of the story even though it is the end of the state machine. */
export function sourceStillHeld(status: string, sourceCleanedAt: string | null): boolean {
  return status === 'done' && sourceCleanedAt === null;
}

/* ------------------------------------------------------------------------------------------------ */
/* THE PREFLIGHT — W034's four checks                                                                */
/* ------------------------------------------------------------------------------------------------ */

/** W034: "✓ no open payouts · ✓ no live auctions · ✓ outbox drained · ✓ 2.1 GB < window budget", and its failure state:
 *  "Open payout batch PB-0713-02 must settle first — **moves never race money.**"
 *
 *  THAT SENTENCE IS THE RULE AND IT IS THE ONE CHECK THAT CANNOT BE WAIVED. The others are about disruption; this one is
 *  about a payout executing against a shard mid-replication, which is how money goes missing rather than how a migration
 *  goes slowly.
 */
export const PREFLIGHT_CHECKS = ['no_open_payouts', 'no_live_auctions', 'outbox_drained', 'within_window_budget'] as const;
export type PreflightCheck = (typeof PREFLIGHT_CHECKS)[number];

/** Which failures may be overridden by an operator with a reason, and which may not.
 *
 *  `no_open_payouts` is UNWAIVABLE. A live auction can be allowed to finish and an outbox can be allowed to drain
 *  mid-copy at some risk of duplicated delivery, both of which a human can reasonably judge; a payout batch executing
 *  against a shard being replicated is a money defect nobody can judge their way out of. Encoded as data so the waiver
 *  path cannot quietly grow to include it.
 */
export const UNWAIVABLE: readonly PreflightCheck[] = Object.freeze(['no_open_payouts']);

export function isWaivable(check: string): boolean {
  return !(UNWAIVABLE as readonly string[]).includes(check);
}

export interface PreflightInput {
  openPayouts: number | null;
  liveAuctions: number | null;
  outboxPending: number | null;
  estimatedBytes: number | null;
  windowBudgetBytes: number | null;
}

export type CheckResult =
  | { check: PreflightCheck; ok: true }
  | { check: PreflightCheck; ok: false; detail: string; waivable: boolean }
  /** The check could not be run. **NOT A PASS** — this is the whole reason the inputs are nullable: a cross-plane read
   *  that failed must not be reported as a clean result, and a preflight where two of four checks could not run is a
   *  preflight nobody should sign. */
  | { check: PreflightCheck; ok: false; detail: string; waivable: false; unknown: true };

export interface PreflightResult {
  pass: boolean;
  checks: CheckResult[];
  blocking: PreflightCheck[];
  unknown: PreflightCheck[];
}

export function preflight(i: PreflightInput): PreflightResult {
  const checks: CheckResult[] = [];

  const num = (v: number | null, check: PreflightCheck, label: string): void => {
    if (v === null || !Number.isFinite(v)) {
      checks.push({
        check, ok: false, waivable: false, unknown: true,
        detail: `${label} could not be read, so this check did not run — an unrun check is not a passed one`,
      });
      return;
    }
    if (v > 0) {
      checks.push({
        check, ok: false, waivable: isWaivable(check),
        detail: check === 'no_open_payouts'
          ? `${v} payout(s) are still open. Moves never race money — settle them first; this check cannot be waived.`
          : `${v} ${label} outstanding`,
      });
      return;
    }
    checks.push({ check, ok: true });
  };

  num(i.openPayouts, 'no_open_payouts', 'open payouts');
  num(i.liveAuctions, 'no_live_auctions', 'live auctions');
  num(i.outboxPending, 'outbox_drained', 'outbox events');

  if (i.estimatedBytes === null || i.windowBudgetBytes === null
      || !Number.isFinite(i.estimatedBytes) || !Number.isFinite(i.windowBudgetBytes)) {
    checks.push({
      check: 'within_window_budget', ok: false, waivable: false, unknown: true,
      detail: 'the data size or the window budget is unknown, so whether the copy fits could not be established',
    });
  } else if (i.estimatedBytes > i.windowBudgetBytes) {
    checks.push({
      check: 'within_window_budget', ok: false, waivable: true,
      detail: `${i.estimatedBytes} bytes exceeds the ${i.windowBudgetBytes}-byte window budget`,
    });
  } else {
    checks.push({ check: 'within_window_budget', ok: true });
  }

  const failed = checks.filter((c): c is Extract<CheckResult, { ok: false }> => !c.ok);
  return {
    // AN UNKNOWN BLOCKS. A preflight that passed on three checks and could not run the fourth is not a pass, and the
    // person about to freeze a farmer's tenant for four minutes is entitled to know which is which.
    pass: failed.length === 0,
    checks,
    blocking: failed.filter((c) => !('unknown' in c)).map((c) => c.check),
    unknown: failed.filter((c) => 'unknown' in c).map((c) => c.check),
  };
}

/** May this job be started, given its preflight and any waivers?
 *
 *  Waivers are per-check and each needs its own reason, so "I waived the preflight" is never a thing anybody can do — the
 *  granularity IS the control. And an UNKNOWN can never be waived: waiving a check that did not run is asserting a result
 *  nobody has.
 */
export function assertStartable(i: {
  status: string;
  preflight: PreflightResult;
  waived: readonly { check: string; reason: string }[];
  approvedByAdminId: string | null;
}): void {
  if (i.status !== 'queued') {
    throw new InvalidCellsInputError(`this job is ${i.status}; only a queued job can start`);
  }
  if (!i.approvedByAdminId) {
    throw new InvalidCellsInputError(
      'this job has no checker approval. W034\'s wizard ends in "Submit for checker approval", and a job that began '
      + 'copying a farmer\'s data with no approver on the row would be the defect this programme keeps finding.');
  }
  const waivedSet = new Set(i.waived.filter((w) => w.reason.trim().length >= 20).map((w) => w.check));

  for (const c of i.preflight.unknown) {
    throw new InvalidCellsInputError(
      `the '${c}' check did not run, and an unrun check cannot be waived — waiving it would assert a result nobody has. `
      + 'Fix the read and re-run the preflight.');
  }
  for (const c of i.preflight.blocking) {
    if (!isWaivable(c)) {
      throw new InvalidCellsInputError(
        c === 'no_open_payouts'
          ? 'open payouts must settle before a move. Moves never race money, and this check cannot be waived.'
          : `the '${c}' check cannot be waived`);
    }
    if (!waivedSet.has(c)) {
      throw new InvalidCellsInputError(
        `the '${c}' check failed and has not been waived. A waiver needs its own reason of at least 20 characters — `
        + 'per check, so "I waived the preflight" is never something anybody can do.');
    }
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* THE WINDOW AND THE FREEZE                                                                         */
/* ------------------------------------------------------------------------------------------------ */

/** W034 offers "Tonight 02:00–03:00 IST (low traffic)" and "Sunday 03:00–04:00 IST". */
export function inWindow(nowMs: number, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const s = Date.parse(start); const e = Date.parse(end);
  // An unreadable window is NOT open. A migration starting outside its agreed window is a write freeze nobody warned the
  // tenant about.
  if (Number.isNaN(s) || Number.isNaN(e)) return false;
  return nowMs >= s && nowMs < e;
}

/** W034: "≤ 4 min during cutover (tenant sees offline-bar, actions queue)." */
export const DEFAULT_FREEZE_BUDGET_SECONDS = 240;

export type FreezeVerdict =
  | { kind: 'not_started' }
  | { kind: 'running'; elapsedSeconds: number; budgetSeconds: number; overBudget: boolean }
  | { kind: 'finished'; elapsedSeconds: number; budgetSeconds: number; overBudget: boolean }
  | { kind: 'unreadable' };

/** The freeze, measured rather than promised.
 *
 *  "We promised four minutes" and "it took four minutes" are different claims and only the second is evidence — so the
 *  budget and the elapsed time are both carried, and an over-budget freeze is reported as such after the fact rather than
 *  quietly meeting its own target.
 */
export function freezeVerdict(startedAt: string | null, endedAt: string | null, budgetSeconds: number, nowMs: number): FreezeVerdict {
  if (!startedAt) return { kind: 'not_started' };
  const s = Date.parse(startedAt);
  if (Number.isNaN(s)) return { kind: 'unreadable' };
  if (!endedAt) {
    const elapsed = Math.max(0, Math.floor((nowMs - s) / 1000));
    return { kind: 'running', elapsedSeconds: elapsed, budgetSeconds, overBudget: elapsed > budgetSeconds };
  }
  const e = Date.parse(endedAt);
  if (Number.isNaN(e)) return { kind: 'unreadable' };
  const elapsed = Math.max(0, Math.floor((e - s) / 1000));
  return { kind: 'finished', elapsedSeconds: elapsed, budgetSeconds, overBudget: elapsed > budgetSeconds };
}

/** W034: "source cleanup after 7-day safety hold". */
export const SAFETY_HOLD_DAYS = 7;

export function safetyHoldUntil(cutoverEndedAtMs: number): string {
  return new Date(cutoverEndedAtMs + SAFETY_HOLD_DAYS * 86_400_000).toISOString();
}

export type CleanupVerdict =
  | { kind: 'not_applicable' }
  | { kind: 'holding'; daysRemaining: number }
  | { kind: 'due' }
  | { kind: 'done'; at: string };

export function cleanupVerdict(status: string, safetyHoldUntilIso: string | null, cleanedAt: string | null, nowMs: number): CleanupVerdict {
  if (status !== 'done') return { kind: 'not_applicable' };
  if (cleanedAt) return { kind: 'done', at: cleanedAt };
  if (!safetyHoldUntilIso) return { kind: 'not_applicable' };
  const until = Date.parse(safetyHoldUntilIso);
  // An unreadable hold date keeps the source. The safe direction on "may we delete the original copy of a farmer's data"
  // is always to wait.
  if (Number.isNaN(until)) return { kind: 'holding', daysRemaining: SAFETY_HOLD_DAYS };
  if (nowMs >= until) return { kind: 'due' };
  return { kind: 'holding', daysRemaining: Math.max(1, Math.ceil((until - nowMs) / 86_400_000)) };
}

/* ------------------------------------------------------------------------------------------------ */
/* THE VERIFY                                                                                        */
/* ------------------------------------------------------------------------------------------------ */

/** W034: "row counts + ledger zero-sum on target must match source."
 *
 *  BOTH, AND THE ZERO-SUM IS NOT OPTIONAL. Row counts alone would pass a copy that moved every row and corrupted the
 *  money — and ADMIN-6 spent a wave on the fact that a ledger's own arithmetic is the thing worth checking. Comparing the
 *  ledger sum as a STRING because it is a bigint of minor units: a verify that compared money through a float would be a
 *  verify that could pass on a difference of one paisa in a very large number.
 */
export type VerifyVerdict =
  | { kind: 'match'; rows: number }
  | { kind: 'row_mismatch'; sourceRows: number; targetRows: number }
  | { kind: 'ledger_mismatch'; sourceSum: string; targetSum: string }
  | { kind: 'incomplete'; reason: string };

export function verifyCopy(i: {
  sourceRows: number | null; targetRows: number | null;
  sourceLedgerMinor: string | null; targetLedgerMinor: string | null;
}): VerifyVerdict {
  if (i.sourceRows === null || i.targetRows === null
      || !Number.isFinite(i.sourceRows) || !Number.isFinite(i.targetRows)) {
    return { kind: 'incomplete', reason: 'row counts could not be read on both sides' };
  }
  if (i.sourceRows !== i.targetRows) {
    return { kind: 'row_mismatch', sourceRows: i.sourceRows, targetRows: i.targetRows };
  }
  if (i.sourceLedgerMinor === null || i.targetLedgerMinor === null) {
    // AN UNVERIFIED LEDGER IS NOT A VERIFIED ONE. Returning `match` on the row counts alone would be the verify saying
    // "the money is fine" about a sum it never read.
    return { kind: 'incomplete', reason: 'the ledger sum could not be read on both sides' };
  }
  // Compared as bigint, never as a number: 2^53 minor units is about ₹90,071,992,547 and a tenant's ledger can exceed it.
  let s: bigint; let t: bigint;
  try { s = BigInt(i.sourceLedgerMinor); t = BigInt(i.targetLedgerMinor); }
  catch { return { kind: 'incomplete', reason: 'a ledger sum could not be read as a whole number of minor units' }; }
  if (s !== t) {
    return { kind: 'ledger_mismatch', sourceSum: i.sourceLedgerMinor, targetSum: i.targetLedgerMinor };
  }
  return { kind: 'match', rows: i.sourceRows };
}

/** Does this verdict permit a cutover? ONLY an exact match — `incomplete` is a refusal, not a shrug. */
export function verifyPermitsCutover(v: VerifyVerdict): boolean { return v.kind === 'match'; }

/* ------------------------------------------------------------------------------------------------ */
/* WHAT NOBODY RUNS                                                                                  */
/* ------------------------------------------------------------------------------------------------ */

/** **THE PIPELINE IS DESIGNED AND NOT RUNNING**, and every surface that shows a job must be able to say so.
 *
 *  Exported as a constant rather than left to each page, because the single most likely way this wave becomes a defect is
 *  a console that renders `queued` as though something were about to pick it up. Five status columns on this platform have
 *  already recorded acts nobody performs; a seven-state pipeline would be the sixth and largest.
 */
export const PIPELINE_EXECUTOR_EXISTS = false;
export const PIPELINE_EXECUTOR_OWNER = 'ADMIN-8b-Q1' as const;
