// apps/admin-api/src/modules/billing-ops/domain/invoice-payment.ts · pure rules for recording money RECEIVED
// against a SaaS invoice (PC-56 ADMIN-1b, closes ADMIN-1-Q1; table in migration 0092).
//
// THE POINT OF THIS FILE. Before 0092 the platform could reach `partially_paid` without recording how much had been
// paid, so "what does this tenant owe?" had no answer — the collection queue had to say "balance unknown". The whole
// design here exists to make that number derived and therefore trustworthy:
//   • the received total is a SUM over signed payment rows (receipts positive, reversals negative), never an
//     incremented counter — a retried insert cannot drift it and a reversal cannot be forgotten;
//   • the invoice's STATUS is computed from that sum, never asserted by an operator;
//   • an overpayment is preserved and named, not clamped away.
// Everything is bigint minor units (Law 2). No I/O, no framework → unit-provable.
import { InvoiceStatus } from './invoice.state';
import { InvalidPaymentError } from './billing-ops.errors';

/** How the money arrived. `offset` is the non-cash case: an approved billing adjustment or credit note settling part
 *  of an invoice — recorded as a payment so the invoice's arithmetic is complete, and distinguishable from real cash
 *  because a reconciliation against the bank statement must not expect to find it there. */
export const PAYMENT_METHODS = ['bank_transfer', 'upi', 'cheque', 'card', 'netbanking', 'wallet', 'cash', 'offset'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Per-payment sanity cap (₹100 crore in paise). Not a business limit — a fat-finger guard: a SaaS invoice this size
 *  does not exist, so a value above it is a typo or an attack, and either way it should be refused loudly rather
 *  than silently settle every invoice a tenant will ever receive. */
export const MAX_PAYMENT_MINOR = 100_000_000_000n;

/** Validate a receipt amount. Positive only — a negative "payment" is a reversal and has its own path, because the
 *  two are different acts and confusing them means erasing money by passing the wrong sign. */
export function assertReceiptAmount(amountMinor: bigint): bigint {
  if (amountMinor <= 0n) throw new InvalidPaymentError('amount_minor must be a positive integer (minor units)');
  if (amountMinor > MAX_PAYMENT_MINOR) throw new InvalidPaymentError(`amount exceeds the per-payment sanity cap (${MAX_PAYMENT_MINOR})`);
  return amountMinor;
}

/** A reference is what an auditor matches against the bank statement (UTR, cheque number, gateway id). Mandatory:
 *  a payment nobody can later trace is an assertion, not a record. Mirrors the 0092 CHECK. */
export function assertReference(reference: string): string {
  const r = reference.trim();
  if (r.length < 3) throw new InvalidPaymentError('reference must be at least 3 characters (UTR / cheque no / gateway ref)');
  if (r.length > 120) throw new InvalidPaymentError('reference is too long (max 120)');
  return r;
}

/** The currency must be the INVOICE's. A payment in another currency is not a partial payment, it is an unrecorded
 *  FX conversion — and this platform does not invent a rate (Law 2). Refused rather than converted. */
export function assertSameCurrency(invoiceCurrency: string, paymentCurrency: string): void {
  if (invoiceCurrency !== paymentCurrency) {
    throw new InvalidPaymentError(`payment currency ${paymentCurrency} does not match the invoice currency ${invoiceCurrency}; record the converted amount in ${invoiceCurrency}`);
  }
}

/** Only an invoice that is actually owed can receive a payment.
 *   • `draft` — never sent, so nothing is owed yet and a "payment" against it would be unexplainable.
 *   • `void`  — written off; money arriving against a void invoice is a real event but it is NOT this invoice's
 *               payment, and recording it here would silently un-void a decision someone took with a reason.
 *   • `paid`  — refused, so a duplicate receipt cannot quietly become an overpayment on a settled invoice; if money
 *               genuinely arrived twice, that is a refund conversation, not a second payment row. */
const PAYABLE: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>(['issued', 'partially_paid', 'overdue']);
export function assertPayable(status: InvoiceStatus): void {
  if (!PAYABLE.has(status)) {
    throw new InvalidPaymentError(`invoice in status '${status}' cannot receive a payment`);
  }
}

/**
 * The status the invoice should now be in, given the money actually received.
 *
 * THIS IS THE FUNCTION THAT REPLACES A HUMAN TYPING "paid". 0002's comment on `invoice_status` said paid and
 * partially_paid "arrive from payment reconciliation, never a manual mark" — this is that reconciliation, and it is
 * pure arithmetic on two bigints. Returns null when the status should not change, so the caller only writes (and only
 * audits a transition) when something really moved.
 *
 * `paidMinor >= totalMinor` settles the invoice INCLUDING the overpaid case: the excess is kept on the invoice (see
 * `overpaidMinor`) rather than the sum being clamped, because clamping destroys money the tenant sent.
 *
 * `pastDue` decides where a FULLY REVERSED invoice lands (`overdue` vs `issued`) — the caller knows the due date, and
 * guessing here would age a tenant's account wrongly.
 */
export function statusAfterPayments(
  current: InvoiceStatus,
  totalMinor: bigint,
  paidMinor: bigint,
  pastDue: boolean,
): InvoiceStatus | null {
  if (paidMinor >= totalMinor) return current === 'paid' ? null : 'paid';
  if (paidMinor > 0n) return current === 'partially_paid' ? null : 'partially_paid';
  // Nothing (or nothing left) received: every payment was reversed. The invoice must stop claiming money we no
  // longer believe arrived, so it goes back to being simply owed — `overdue` if it is past its due date, otherwise
  // `issued`. Both edges exist only in the RECONCILIATION table (invoice.state.ts), which is why an operator still
  // cannot make this move by hand.
  const target: InvoiceStatus = pastDue ? 'overdue' : 'issued';
  return current === target ? null : target;
}

/** The excess, when a tenant paid more than the invoice asked for. Zero (never negative) otherwise. Surfaced so
 *  finance can refund or credit it deliberately — an overpayment that only exists as an invisible difference between
 *  two columns is money the tenant will eventually ask about and nobody will be able to explain. */
export function overpaidMinor(totalMinor: bigint, paidMinor: bigint): bigint {
  const excess = paidMinor - totalMinor;
  return excess > 0n ? excess : 0n;
}

/** What is still owed. Now that payments are recorded this is a real number rather than an unknown — which was the
 *  entire reason for migration 0092. Floors at zero: an overpaid invoice owes nothing, and the excess is reported
 *  separately rather than as a negative balance that a caller might sum into a receivables total. */
export function outstandingMinor(totalMinor: bigint, paidMinor: bigint): bigint {
  const owed = totalMinor - paidMinor;
  return owed > 0n ? owed : 0n;
}

/** A received-at in the future is a typo (or a clock problem), and a payment dated tomorrow would age the invoice
 *  wrongly for as long as it existed. A small tolerance absorbs clock skew between the operator's machine and ours. */
export const RECEIVED_AT_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
export function assertReceivedAt(receivedAt: Date, now: Date): Date {
  if (Number.isNaN(receivedAt.getTime())) throw new InvalidPaymentError('received_at is not a valid timestamp');
  if (receivedAt.getTime() > now.getTime() + RECEIVED_AT_FUTURE_TOLERANCE_MS) {
    throw new InvalidPaymentError('received_at cannot be in the future');
  }
  return receivedAt;
}
