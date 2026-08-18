// modules/payments/domain/payout-batch.state.ts
// Lifecycle of a payout BATCH (the bookkeeping envelope around a set of disbursements — a daily
// settlement run or a weekly ambassador run). The batch is NOT the money transaction of record (each
// payout's wallet move is its own ACID tx via the wallet boundary); the batch records how many
// payouts were grouped + the settled total, so a run is auditable and reconcilable.
//   open              — created by the platform sweep; payouts may still be claimed into it.
//   pending_approval  — PC-56 TENANT-4b: a TENANT batch a maker prepared, waiting on a checker (W146).
//   approved          — signed; the executor may disburse it once execute_at arrives.
//   rejected          — a checker declined it, with a reason. Terminal, and never executed.
//   expired           — the cut-off passed unapproved: the queue has moved on, so it rolls to a NEW
//                       batch rather than being signed against a list that no longer exists (W146).
//   executing  — disbursement of the claimed payouts is in progress.
//   executed   — the run finished; total_minor + count are final.
//   failed     — the run was abandoned before/while executing (operator/abort); reopened as a NEW batch.
import { DomainError } from '../../../shared/errors/app-error';

export const PAYOUT_BATCH_STATUSES = ['open', 'pending_approval', 'approved', 'rejected', 'expired', 'executing', 'executed', 'failed'] as const;
export type PayoutBatchStatus = (typeof PAYOUT_BATCH_STATUSES)[number];

const TRANSITIONS: Record<PayoutBatchStatus, PayoutBatchStatus[]> = {
  open: ['executing', 'failed'],
  // The approval plane. Note what is ABSENT: pending_approval cannot reach 'executing' directly, so no
  // code path — including a future one written by somebody who has not read W146 — can disburse a batch
  // that was never signed. That is the whole point of putting the gate in the machine.
  pending_approval: ['approved', 'rejected', 'expired'],
  approved: ['executing', 'failed'],
  rejected: [],
  expired: [],
  executing: ['executed', 'failed'],
  executed: [],
  failed: [],
};

export class IllegalPayoutBatchTransitionError extends DomainError {
  constructor(from: PayoutBatchStatus, to: PayoutBatchStatus) {
    super('PAYOUT_BATCH_ILLEGAL_TRANSITION', `Cannot move payout batch from ${from} to ${to}`, 409, { from, to });
  }
}

export function canTransition(from: PayoutBatchStatus, to: PayoutBatchStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
export function assertTransition(from: PayoutBatchStatus, to: PayoutBatchStatus): void {
  if (!canTransition(from, to)) throw new IllegalPayoutBatchTransitionError(from, to);
}
export function isTerminal(s: PayoutBatchStatus): boolean { return TRANSITIONS[s].length === 0; }

/** Is this batch inside the tenant approval plane (as opposed to a platform sweep)? */
export function isApprovalPlane(s: PayoutBatchStatus): boolean {
  return s === 'pending_approval' || s === 'approved' || s === 'rejected' || s === 'expired';
}
