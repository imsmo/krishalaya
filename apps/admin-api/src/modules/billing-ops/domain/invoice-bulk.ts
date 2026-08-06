// apps/admin-api/src/modules/billing-ops/domain/invoice-bulk.ts · pure rules for a BULK invoice transition
// (PC-56 ADMIN-1d, closes ADMIN-1-Q11). No I/O → unit-provable.
//
// Only the three ADMIN-DRIVABLE transitions are bulk-able, and deliberately not the payment-derived ones: `paid` and
// `partially_paid` arrive from recorded payments (0092), so a "bulk mark paid" would be an operator asserting money
// arrived for fifty tenants at once — the exact thing the payments table exists to prevent.
import { InvoiceStatus } from './invoice.state';

export const BULK_ACTIONS = ['issue', 'mark_overdue', 'void'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];
export function isBulkAction(v: string | null | undefined): v is BulkAction {
  return !!v && (BULK_ACTIONS as readonly string[]).includes(v);
}

/** Batch ceiling. Small on purpose: a batch is a decision a human is accountable for, and beyond a page's worth of
 *  invoices nobody has actually reviewed what they selected. Splitting is cheap; an unreviewed bulk void is not. */
export const MAX_BULK_INVOICES = 100;

/** The status each action targets — used by the console to show what a selection WOULD do before it is submitted. */
export function targetStatus(action: BulkAction): InvoiceStatus {
  return action === 'issue' ? 'issued' : action === 'mark_overdue' ? 'overdue' : 'void';
}

/** Would this action apply to an invoice in this status? Mirrors the transition table so the console can say
 *  "3 of your 12 selected invoices cannot be voided" BEFORE the operator commits — a batch that half-fails is honest,
 *  but a batch that could have been corrected first is a wasted round trip and an unnecessary audit row. */
export function appliesTo(action: BulkAction, status: InvoiceStatus): boolean {
  if (action === 'issue') return status === 'draft';
  if (action === 'mark_overdue') return status === 'issued' || status === 'partially_paid';
  return status !== 'paid' && status !== 'void';   // void: anything not already settled or withdrawn
}
