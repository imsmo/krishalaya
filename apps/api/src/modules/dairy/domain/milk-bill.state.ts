// modules/dairy/domain/milk-bill.state.ts · STATE MACHINE for milk_bills.status (Law 5).
//   draft → previewed → approved → paid   (+ disputed from previewed; resolve back to previewed)
//                                          (+ voided from anywhere money has not moved — TENANT-6c-2)
// A cadence pass generates the draft (0157); previewing it starts the member's 24h dispute window and tells them in
// their own language (0158); the member may dispute inside that window; the cooperative approves; the wallet settles →
// paid (terminal). A bill an upheld dispute proved wrong is VOIDED and rebuilt, because nothing on this platform can
// amend a milk bill's arithmetic in place.
import { DomainError } from '../../../shared/errors/app-error';

export const BILL_STATUSES = ['draft', 'previewed', 'disputed', 'approved', 'paid', 'voided'] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

const TRANSITIONS: Readonly<Record<BillStatus, readonly BillStatus[]>> = Object.freeze({
  // [PC-56 TENANT-6c-2] `voided` is the honest resolution for a bill an upheld dispute proved WRONG. This platform has
  // no adjustment line and no credit note on a milk bill, so the only correction available is to release the pours and
  // rebuild: the bill is soft-deleted, `milk_bill_id` is cleared on its collections, and the cycle's next generation
  // pass builds a new one from whatever the pours now say (which is what 6b-1's quality path can already correct).
  // Reachable from every state where no money has moved, and from NOWHERE once it has — voiding a paid bill would be
  // erasing a wallet movement's own justification while the movement stays in the ledger.
  draft:     ['previewed', 'voided'],
  previewed: ['disputed', 'approved', 'voided'],
  disputed:  ['previewed', 'approved', 'voided'],   // resolved → re-previewed, override-approved, or rebuilt
  approved:  ['paid', 'voided'],
  paid:      [],
  voided:    [],
});
export class IllegalBillTransitionError extends DomainError {
  constructor(from: string, to: string) { super('BILL_ILLEGAL_TRANSITION', `Cannot move milk bill ${from}→${to}`, 409, { from, to }); }
}
export function canTransition(from: BillStatus, to: BillStatus): boolean { return TRANSITIONS[from]?.includes(to) ?? false; }
export function assertTransition(from: BillStatus, to: BillStatus): void { if (!canTransition(from, to)) throw new IllegalBillTransitionError(from, to); }
export function isTerminal(s: BillStatus): boolean { return s === 'paid' || s === 'voided'; }
