// modules/tenancy/__tests__/saas-invoice.spec.ts · pure-domain unit tests for API-W3-06: the invoice_status state
// machine (mirrors admin-api billing-ops) + the SaasInvoice aggregate (totals math in bigint minor units,
// issue/applyPaidTotal/markOverdue transitions, idempotent re-payment). Service UoW/outbox/RLS + the
// payment-succeeded handler are covered by saas-invoice.integration.spec.ts.
import { canTransition, isOwing, isTerminal, INVOICE_STATUSES, InvoiceStatus, IllegalInvoiceTransitionError } from '../domain/saas-invoice.state';
import { SaasInvoice } from '../domain/saas-invoice.entity';
import { InvalidSaasInvoiceError, SaasInvoiceNotPayableError } from '../domain/tenancy.errors';
import { TenancyEventType } from '../domain/tenancy.events';

const mk = (over: any = {}) => SaasInvoice.create({
  id: 'inv1', tenantId: 't1', subscriptionId: 's1', invoiceNo: 'SINV-202607-000001', currencyCode: 'INR',
  taxMinor: 0n, dueDate: '2026-07-31',
  lineItems: [{ desc: 'Subscription renewal', qty: 1, unitMinor: 99900n, totalMinor: 99900n }], ...over,
});

describe('invoice_status state machine', () => {
  it('allows documented transitions, forbids illegal ones', () => {
    expect(canTransition('draft', 'issued')).toBe(true);
    expect(canTransition('issued', 'paid')).toBe(true);
    expect(canTransition('issued', 'overdue')).toBe(true);
    expect(canTransition('overdue', 'paid')).toBe(true);
    expect(canTransition('paid', 'issued')).toBe(false);   // terminal
    expect(canTransition('void', 'paid')).toBe(false);      // terminal
    expect(isOwing('issued')).toBe(true); expect(isOwing('partially_paid')).toBe(true); expect(isOwing('paid')).toBe(false);
    expect(isTerminal('paid')).toBe(true); expect(isTerminal('void')).toBe(true);
  });
  it('covers every status', () => { for (const s of INVOICE_STATUSES) expect(() => canTransition(s, 'void' as InvoiceStatus)).not.toThrow(); });
});

describe('SaasInvoice aggregate', () => {
  it('derives totals and validates line math', () => {
    const inv = mk({ taxMinor: 17982n });   // 18% GST on 99900
    const p = inv.toProps();
    expect(p.subtotalMinor).toBe(99900n); expect(p.taxMinor).toBe(17982n); expect(p.totalMinor).toBe(117882n);
    expect(p.status).toBe('draft');
  });
  it('rejects a line whose total ≠ unit × qty, empty lines, and bad dates', () => {
    expect(() => mk({ lineItems: [{ desc: 'x', qty: 2, unitMinor: 100n, totalMinor: 150n }] })).toThrow(InvalidSaasInvoiceError);
    expect(() => mk({ lineItems: [] })).toThrow(InvalidSaasInvoiceError);
    expect(() => mk({ dueDate: '31-07-2026' })).toThrow(InvalidSaasInvoiceError);
  });
  it('issue emits issued; cannot issue twice', () => {
    const inv = mk(); inv.issue();
    expect(inv.status).toBe('issued');
    expect(inv.pullEvents().map((e) => e.type)).toContain(TenancyEventType.SaasInvoiceIssued);
    expect(() => inv.issue()).toThrow(IllegalInvoiceTransitionError);
  });
  /**
   * PC-56 TENANT-4d-2 · `recordPayment(amountMinor, at)` → `applyPaidTotal(paidMinor, at, pastDue)`.
   *
   * **THE OLD VERSION OF THIS TEST IS WHY THE DEFECT SURVIVED.** It read:
   *     expect(part.recordPayment(50000n, ...)).toBe(true);      // → partially_paid
   *     expect(part.recordPayment(60000n, ...)).toBe(false);     // "another partial → no transition"
   *     expect(part.recordPayment(99900n, ...)).toBe(true);      // → paid
   * Every call passed a SINGLE payment's amount and the last one happened to be the FULL invoice total, so the
   * suite never asked what happens when two payments each cover half. The answer was: the invoice stayed
   * `partially_paid` for ever, and `paid_minor` — the column 0092 added so the balance would be a stored fact —
   * was never written at all. The test encoded the bug's own premise, which is the most expensive kind of green.
   * The rule is now: status follows the SUM of the receipts, and the sum is the caller's only input.
   */
  it('applyPaidTotal: TWO HALF PAYMENTS SETTLE THE INVOICE (the old single-amount rule left it part-paid for ever)', () => {
    const part = mk(); part.issue(); part.pullEvents();
    expect(part.applyPaidTotal(50000n, new Date(), false)).toBe(true);
    expect(part.status).toBe('partially_paid');
    // The SECOND half brings the running total to 99,900 — the invoice total — and settles it. Under the old
    // rule this second payment was compared against the total on its own (49,900 < 99,900), computed
    // 'partially_paid', found it already there and returned false.
    expect(part.applyPaidTotal(99900n, new Date(), false)).toBe(true);
    expect(part.status).toBe('paid');
    expect(part.paidMinor).toBe(99900n);
  });

  it('applyPaidTotal: full → paid, paid_at set, re-applying the same total is a no-op', () => {
    const full = mk(); full.issue(); full.pullEvents();
    const at = new Date('2026-07-18T00:00:00Z');
    expect(full.applyPaidTotal(99900n, at, false)).toBe(true);
    expect(full.status).toBe('paid'); expect(full.toProps().paidAt).toEqual(at);
    expect(full.applyPaidTotal(99900n, new Date(), false)).toBe(false);   // idempotent
    // An OVERPAYMENT still settles the invoice and the excess is kept visible, never clamped away (0092).
    const over = mk(); over.issue(); over.pullEvents();
    expect(over.applyPaidTotal(120000n, at, false)).toBe(true);
    expect(over.status).toBe('paid'); expect(over.paidMinor).toBe(120000n);
  });

  it('applyPaidTotal: a receipt against a DRAFT or a VOID invoice is refused by name', () => {
    const draft = mk();
    expect(() => draft.applyPaidTotal(99900n, new Date(), false)).toThrow(SaasInvoiceNotPayableError);
  });

  it('a CREDIT line is ordinary invoice grammar; a net-negative invoice is not', () => {
    // TENANT-1d-2's proration invoice prints the charge and the unused credit as SEPARATE rows, the second
    // negative. `nonNeg(li.unitMinor)` used to reject it, so every mid-cycle upgrade off a paid plan threw
    // instead of raising an invoice — the one invoice W120 actually displays.
    const withCredit = mk({ lineItems: [
      { desc: 'Professional · 18 of 31 days', qty: 1, unitMinor: 80000n, totalMinor: 80000n },
      { desc: 'Unused Growth credit · 18 days', qty: 1, unitMinor: -30000n, totalMinor: -30000n },
    ], taxMinor: 0n });
    expect(withCredit.toProps().subtotalMinor).toBe(50000n);
    expect(withCredit.toProps().totalMinor).toBe(50000n);
    // …but a document whose net is negative is a CREDIT NOTE (0140), with its own gapless series.
    expect(() => mk({ lineItems: [{ desc: 'Credit', qty: 1, unitMinor: -1n, totalMinor: -1n }], taxMinor: 0n })).toThrow(InvalidSaasInvoiceError);
  });

  it('the tax rate is frozen on the invoice, and a rate without tax (or tax without a rate) is refused', () => {
    expect(mk({ taxBp: 1800, taxMinor: 17982n }).toProps().taxBp).toBe(1800);
    expect(mk({ taxBp: null }).toProps().taxBp).toBeNull();        // "not recorded" is NOT 0%
    expect(mk({ taxBp: 0, taxMinor: 0n }).toProps().taxBp).toBe(0);
    expect(() => mk({ taxBp: 1800, taxMinor: 0n })).toThrow(InvalidSaasInvoiceError);
    expect(() => mk({ taxBp: 0, taxMinor: 100n })).toThrow(InvalidSaasInvoiceError);
    expect(() => mk({ taxBp: 10001 })).toThrow(InvalidSaasInvoiceError);
  });

  it('period_tag must be a real YYYYMM, or absent — never a document-number string', () => {
    expect(mk({ periodTag: '202607' }).toProps().periodTag).toBe('202607');
    expect(mk({ periodTag: null }).toProps().periodTag).toBeNull();
    expect(() => mk({ periodTag: 'pc-abc123' })).toThrow(InvalidSaasInvoiceError);
  });
  it('markOverdue only from issued/partially_paid; idempotent', () => {
    const inv = mk(); inv.issue(); inv.pullEvents();
    expect(inv.markOverdue()).toBe(true); expect(inv.status).toBe('overdue');
    expect(inv.markOverdue()).toBe(false);
    const draft = mk();
    expect(draft.markOverdue()).toBe(false);   // a draft is never overdue
  });
});
