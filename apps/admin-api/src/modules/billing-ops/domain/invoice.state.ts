// apps/admin-api/src/modules/billing-ops/domain/invoice.state.ts · the SaaS-invoice status state machine (Law 5 —
// the ONLY place transitions are decided). Mirrors the invoice_status ENUM in db/migrations/0002_tenancy_billing:
//   draft → issued → paid | partially_paid | overdue | void
// 'paid'/'partially_paid' normally arrive from a real payment reconciliation; 'void' (write-off) and
// 'issued'/'overdue' are the consequential admin transitions billing-ops drives. paid/void are terminal.
export const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'partially_paid', 'overdue', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

const TRANSITIONS: Readonly<Record<InvoiceStatus, readonly InvoiceStatus[]>> = Object.freeze({
  draft:          ['issued', 'void'],
  issued:         ['paid', 'partially_paid', 'overdue', 'void'],
  partially_paid: ['paid', 'overdue', 'void'],
  overdue:        ['paid', 'partially_paid', 'void'],
  paid:           [],
  void:           [],
});

export class IllegalInvoiceTransitionError extends Error {
  readonly code = 'BILLING_INVOICE_ILLEGAL_TRANSITION';
  constructor(public readonly from: string, public readonly to: string) {
    super(`Cannot move invoice ${from}→${to}`);
    this.name = 'IllegalInvoiceTransitionError';
  }
}
export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
export function assertTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (!canTransition(from, to)) throw new IllegalInvoiceTransitionError(from, to);
}
export function isTerminal(s: InvoiceStatus): boolean { return s === 'paid' || s === 'void'; }

// ---------------------------------------------------------------------------
// RECONCILIATION transitions (PC-56 ADMIN-1b · driven by recorded payments only)
// ---------------------------------------------------------------------------
// The table above is the set of moves an OPERATOR may drive. This second, narrower table is the set of moves the
// PAYMENT ARITHMETIC may drive (0092 `saas_invoice_payments` → `statusAfterPayments`). They are deliberately separate
// rather than one loosened table, for two reasons that both matter:
//
//   1. A BOUNCED CHEQUE ON A SETTLED INVOICE IS A REAL EVENT. `paid` is terminal above — correctly, because no
//      operator should be able to reopen a settled invoice by hand. But when a recorded payment is REVERSED and the
//      received sum drops below the total, the invoice genuinely is not paid any more, and a machine that cannot say
//      so leaves the platform believing money it does not have. So `paid` has outbound edges HERE and nowhere else.
//   2. `void` IS ABSENT FROM THIS TABLE. Writing an invoice off is a decision with a reason and an audit trail; it
//      must never be reachable as a side effect of arithmetic. Keeping the two tables separate is what guarantees
//      that a payment-path bug can never void an invoice.
//
// Every edge here is a consequence of a SUM over append-only payment rows, so it is reproducible from the ledger of
// payments at any later date — which is exactly what a tenant disputing a balance is entitled to.
const RECONCILIATION_TRANSITIONS: Readonly<Record<InvoiceStatus, readonly InvoiceStatus[]>> = Object.freeze({
  draft:          [],                                        // never sent, so nothing can be owed or received
  issued:         ['paid', 'partially_paid'],
  partially_paid: ['paid', 'issued', 'overdue'],             // 'issued' = the last payment was reversed, nothing received
  overdue:        ['paid', 'partially_paid'],                 // stays overdue when fully reversed (it IS past due)
  paid:           ['partially_paid', 'issued', 'overdue'],    // a reversal (bounced cheque / wrong invoice) reopens it
  void:           [],                                        // written off; money arriving is not this invoice's payment
});

export function canReconcileTo(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return RECONCILIATION_TRANSITIONS[from]?.includes(to) ?? false;
}
export function assertReconciliation(from: InvoiceStatus, to: InvoiceStatus): void {
  if (!canReconcileTo(from, to)) throw new IllegalInvoiceTransitionError(from, to);
}
