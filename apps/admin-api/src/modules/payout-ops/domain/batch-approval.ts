// apps/admin-api/src/modules/payout-ops/domain/batch-approval.ts · W066/W067's gate, PURE (PC-56 ADMIN-6b).
//
// ---------------------------------------------------------------------------
// WHAT THIS REPLACES: A BATCH THAT WAS A REPORT PRETENDING TO BE A CONTROL
// ---------------------------------------------------------------------------
// Before 0114 a payout batch was a bookkeeping envelope written AFTER the fact: `PayoutBatchService.runBatch` opened
// one, claimed queued payouts into it, disbursed them, and recorded the total. There was no approval step anywhere in
// that sequence, no columns to record one, and the executor that actually moves money
// (`payout-execution.cadence-job.ts`, every 5 minutes) never looked at a batch at all.
//
// So W066's "every batch checker-approved before execution" and W067's "Approve & execute · maker Priya S. ≠ checker
// (you) enforced" described a control that existed in neither the schema nor the code. This module is the state machine
// that makes the batch a gate, and 0114's trigger is what makes it one even if this module is bypassed.
import { SecondPersonRequiredError, assertSecondPerson, isSecondPerson } from '../../../core/approval/two-person-rule';
import { InvalidPayoutOpsError } from './payout-ops.errors';

/** The ratified state set — 0114's `ck_payout_batch_status`. W066's footnote asked for exactly this ("exact state set
 *  to be ratified (BACKEND CONFIRM)"); the canon's `open|executed` was describing the two badges the screen drew, and
 *  `payout-batch.state.ts` in apps/api already had four. */
export const BATCH_STATUSES = ['open', 'approved', 'returned', 'executing', 'executed', 'failed'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

/** The states from which money may leave. Written as its own exported constant rather than inlined into a comparison,
 *  because it is the single most important fact in this module and the SQL claim gate in apps/api has to agree with it
 *  exactly — a disagreement between the two would either strand a run or open the door. */
export const EXECUTABLE_STATUSES: readonly BatchStatus[] = Object.freeze(['approved', 'executing']);

export interface BatchRow {
  id: string;
  tenantId: string | null;
  batchType: string;
  totalMinor: bigint;
  count: number;
  status: string;
  executedAt: string | null;
  openedByAdminId: string | null;
  approvedByAdminId: string | null;
  approvedAt: string | null;
  returnedByAdminId: string | null;
  returnedAt: string | null;
  returnReason: string | null;
  preflight: Record<string, unknown> | null;
  preflightAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------------------------------------ */
/* THE APPROVAL DECISION                                                                             */
/* ------------------------------------------------------------------------------------------------ */

export type ApprovalState =
  /** Approvable now, by this viewer. */
  | { kind: 'approvable' }
  /** The batch is fine but this person may not sign it — they opened it. Rendered as an ABSENCE of the control plus the
   *  reason, never as a disabled button (the standing maker-checker-by-absence doctrine). W067 has this exact state:
   *  "Approval locked — you are the maker of this batch." */
  | { kind: 'needs_other_operator' }
  /** Already decided. Carries which way, because "already approved" and "already returned" send an operator to
   *  different next actions. */
  | { kind: 'already'; status: BatchStatus }
  /** Nothing in it. W067: "Batch empty — batches build from settlement/wage runs; an empty batch cannot be approved." */
  | { kind: 'empty' }
  /** The preflight says at least one payout cannot go. */
  | { kind: 'blocked'; blocked: number }
  /** No preflight has been run, so there is nothing to approve AGAINST. Distinct from `blocked`: one is a known
   *  problem and the other is not knowing, and a checker must not be shown a green button in the second case. */
  | { kind: 'no_preflight' };

export interface ApprovalInputs {
  status: string;
  count: number;
  openedByAdminId: string | null;
  viewerAdminId: string | null;
  /** A FRESH preflight, not the stored one. The stored copy records what a checker was shown; the decision to let them
   *  sign has to be made against the world as it is now. */
  preflight: { pass: boolean; checked: number; blocked: number } | null;
}

/** Should the console draw the Approve control, and if not, why not.
 *
 *  THE ORDER OF THESE CHECKS IS THE DESIGN. A decided batch is reported as decided even if its preflight has since
 *  gone bad, because "this was already approved" is the fact the operator needs and re-litigating a signed decision on
 *  a read screen would be noise. An empty batch is reported before a preflight verdict, because `preflight([])`
 *  correctly refuses to pass and "0 blocked, does not pass" is a confusing way to say "there is nothing here".
 */
export function approvalState(i: ApprovalInputs): ApprovalState {
  if (i.status !== 'open') {
    return BATCH_STATUSES.includes(i.status as BatchStatus)
      ? { kind: 'already', status: i.status as BatchStatus }
      // A status this code does not know is not treated as approvable. 0114's CHECK constrains the column, so this is
      // reachable only if the vocabulary grows — and the safe direction on the money door is to refuse and let a human
      // ask why.
      : { kind: 'already', status: 'failed' };
  }
  if (i.count <= 0) return { kind: 'empty' };
  if (!i.preflight) return { kind: 'no_preflight' };
  if (i.preflight.checked === 0) return { kind: 'empty' };
  if (i.preflight.blocked > 0) return { kind: 'blocked', blocked: i.preflight.blocked };
  if (!i.preflight.pass) return { kind: 'blocked', blocked: i.preflight.blocked };
  if (!isSecondPerson(i.openedByAdminId, i.viewerAdminId)) return { kind: 'needs_other_operator' };
  return { kind: 'approvable' };
}

/** The write-side gate. Throws; never returns a boolean.
 *
 *  `approvalState` decides what to DRAW and this decides what to ALLOW, and they are separate functions on purpose: the
 *  display side errs toward showing a control the server may refuse (a redundant refusal is recoverable; a wrongly
 *  hidden control blocks lawful work with no explanation), and this side errs toward refusing. `isSecondPerson` returns
 *  true for an unknown viewer for that display reason, and `assertSecondPerson` throws for one — the asymmetry is
 *  deliberate and is documented in the shared helper.
 */
export function assertApprovable(i: {
  status: string;
  count: number;
  openedByAdminId: string | null;
  approverAdminId: string;
  preflight: { pass: boolean; checked: number; blocked: number } | null;
}): void {
  if (i.status !== 'open') {
    throw new InvalidPayoutOpsError(
      `this batch is ${i.status}; only an open batch can be approved. A corrected run is a NEW batch, so that the `
      + 'refused one stays on the record.');
  }
  if (i.count <= 0) {
    throw new InvalidPayoutOpsError('this batch contains no payouts; approving it would execute a run that disburses nothing');
  }
  if (!i.preflight) {
    throw new InvalidPayoutOpsError(
      'no preflight has been run against this batch. Approval is a signature on a set of checks, and there are none '
      + 'to sign — run the preflight first.');
  }
  if (i.preflight.checked === 0) {
    throw new InvalidPayoutOpsError('the preflight found no payouts to check; an empty batch cannot be approved');
  }
  if (i.preflight.blocked > 0 || !i.preflight.pass) {
    throw new InvalidPayoutOpsError(
      `${i.preflight.blocked} of ${i.preflight.checked} payouts in this batch cannot be disbursed (expired KYC, `
      + 'unverified bank account, or a frozen wallet). A batch approves as a whole: remove the blocked payouts into '
      + 'their own batch, or fix them, and preflight again.');
  }
  // Last, so the operator learns about a substantive problem before being told to find a colleague.
  assertSecondPerson('Approving a payout batch', i.openedByAdminId, i.approverAdminId,
    'The operator who opened a batch cannot authorise its execution.');
}

/** A return needs a reason a human wrote and can be read by the person whose work was refused.
 *
 *  20 characters, matching 0114's CHECK and 0112's moderation floor, and for the same argument: "no" is not a review.
 *  The maker has to know what to change, and a returned batch that says nothing produces the same batch again.
 */
export const RETURN_REASON_MIN = 20;

export function assertReturnable(i: { status: string; reason: string; returnerAdminId: string }): void {
  if (i.status !== 'open') {
    throw new InvalidPayoutOpsError(`this batch is ${i.status}; only an open batch can be returned to its maker`);
  }
  if (!i.returnerAdminId) throw new InvalidPayoutOpsError('the returning operator could not be identified');
  const r = i.reason.trim();
  if (r.length < RETURN_REASON_MIN) {
    throw new InvalidPayoutOpsError(
      `a return needs at least ${RETURN_REASON_MIN} characters explaining what the maker should change; this batch's `
      + 'maker is the only reader of it');
  }
}

/** A RETURN IS NOT SUBJECT TO THE TWO-PERSON RULE, and the asymmetry is deliberate.
 *
 *  Approving is the act with consequences — money leaves. Returning is refusing to let it, and refusing your own batch
 *  is just noticing your own mistake, which is behaviour to encourage rather than block. Requiring a second person to
 *  withdraw a batch would mean an operator who spots their own error at 02:00 has to wake somebody to stop it. The
 *  worst case is that somebody cancels their own run, which is recoverable by opening another one.
 *
 *  Written as its own exported predicate rather than left as an absent check, because "there is no maker≠checker rule
 *  here" reads as an omission in review, and the next person tightening the module would add one.
 */
export function returnNeedsSecondPerson(): boolean { return false; }

/* ------------------------------------------------------------------------------------------------ */
/* WHAT THE SCREEN SAYS ABOUT AN APPROVED BATCH                                                      */
/* ------------------------------------------------------------------------------------------------ */

/** W067's header line: "open · awaiting checker" / "approved 18:40 by Dev V." and so on.
 *
 *  `awaiting_checker` is a DERIVED state, not a stored one — a batch is 'open' in the database and awaiting a checker in
 *  the console. Deriving it means there is no second column to disagree with `status`, which is the failure this whole
 *  plane keeps finding.
 */
export type BatchPhase = 'awaiting_checker' | 'approved' | 'returned' | 'executing' | 'executed' | 'failed' | 'unknown';

export function batchPhase(status: string): BatchPhase {
  switch (status) {
    case 'open': return 'awaiting_checker';
    case 'approved': return 'approved';
    case 'returned': return 'returned';
    case 'executing': return 'executing';
    case 'executed': return 'executed';
    case 'failed': return 'failed';
    default: return 'unknown';
  }
}

/** Money the batch has ACTUALLY moved, versus money it was approved for.
 *
 *  `payout_batches.total_minor` is incremented by `addSettled` on each SUCCESSFUL disbursement — so on an executed
 *  batch it is what left, and on an open one it is 0. The figure a checker signs is the Σ of the payouts inside it,
 *  which is a different number from a different table. Both are reported and labelled, because a screen showing one
 *  under the heading of the other is how "₹4,82,120 executed" comes to mean "₹4,82,120 was attempted".
 */
export interface BatchMoney {
  /** Σ amount_minor over the payouts in the batch — the figure under review. */
  requestedMinor: bigint;
  /** `payout_batches.total_minor` — what the run recorded as settled. */
  settledMinor: bigint;
  /** True once the batch has run and the two disagree: some payouts failed. */
  shortfall: boolean;
  shortfallMinor: bigint;
}

export function batchMoney(status: string, requestedMinor: bigint, settledMinor: bigint): BatchMoney {
  // Before execution the settled figure is meaningfully zero rather than a shortfall, so the comparison is only made
  // on a batch that has finished. An 'executing' batch is mid-run and a partial total there is expected, not a finding.
  const finished = status === 'executed' || status === 'failed';
  const diff = requestedMinor - settledMinor;
  return {
    requestedMinor,
    settledMinor,
    shortfall: finished && diff > 0n,
    shortfallMinor: finished && diff > 0n ? diff : 0n,
  };
}

export { SecondPersonRequiredError };
