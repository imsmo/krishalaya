// core/bulk/domain/bulk-import.state.ts · the bulk_import_jobs.status state machine (Law 5 — the ONLY place
// import-job transitions are decided). Mirrors the CHECK in db/migrations/0030:
//   pending → processing → completed | partially_completed | failed
//   pending → cancelled (cancel before it starts); processing → cancelled (operator abort)
import { DomainError } from '../../../shared/errors/app-error';
import { BulkStatus } from './bulk-import.events';

const TRANSITIONS: Readonly<Record<BulkStatus, readonly BulkStatus[]>> = Object.freeze({
  // PC-56 TENANT-1b-4: `pending → validating → validated → processing` is W156's triage, and `pending → processing` stays
  // for appliers that declare no `validateRow` (the pre-existing 'products' path). Both routes are legal, which is what
  // lets one screen gain a confirm step without every other import growing one.
  pending:             ['validating', 'processing', 'cancelled'],
  validating:          ['validated', 'failed', 'cancelled'],
  // **`validated → processing` IS THE ONLY WAY OUT TOWARD WORK, AND NEVER BACK TO `validating`.** Re-validating in place
  // would let a second pass overwrite the report an operator is looking at while they decide — so a stale report is
  // cancelled and the file re-uploaded, which is also the only honest answer when the register has moved underneath it.
  validated:           ['processing', 'cancelled'],
  processing:          ['completed', 'partially_completed', 'failed', 'cancelled'],
  completed:           [],
  partially_completed: [],
  failed:              [],
  cancelled:           [],
});

export class IllegalBulkTransitionError extends DomainError {
  constructor(from: string, to: string) { super('BULK_ILLEGAL_TRANSITION', `Cannot move import job ${from}→${to}`, 409, { from, to }); }
}
export function canTransition(from: BulkStatus, to: BulkStatus): boolean { return TRANSITIONS[from]?.includes(to) ?? false; }
export function assertTransition(from: BulkStatus, to: BulkStatus): void { if (!canTransition(from, to)) throw new IllegalBulkTransitionError(from, to); }
/** A file waiting for somebody to press a button still holds a slot against the per-tenant cap: five abandoned
 *  validations must not let a sixth start. Mirrors 0129's `idx_bulk_jobs_active`. */
export function isActive(s: BulkStatus): boolean {
  return s === 'pending' || s === 'validating' || s === 'validated' || s === 'processing';
}
export function isTerminal(s: BulkStatus): boolean { return !isActive(s); }
/** Final status from the row tallies (all-fail or fatal handled by the caller before this). */
export function terminalFor(succeeded: number, failed: number): BulkStatus {
  if (failed === 0) return 'completed';
  if (succeeded === 0) return 'failed';
  return 'partially_completed';
}
