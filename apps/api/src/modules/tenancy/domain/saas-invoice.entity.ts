// modules/tenancy/domain/saas-invoice.entity.ts · a SaaS invoice we raise TO a tenant for its subscription
// (0002 saas_invoices + 0035 dunning columns). Pure TS. Money is ALWAYS bigint minor units; totals are derived
// (subtotal + tax) and validated, never floats. Status moves ONLY through the state machine (Law 5). No version
// column → the service locks the row FOR UPDATE. Collection/void/adjustment are god-mode (admin-api billing-ops).
import { InvoiceStatus, assertTransition } from './saas-invoice.state';
import { acceptsPayment, statusFromPaid } from './saas-invoice-balance';
import { InvalidSaasInvoiceError, SaasInvoiceNotPayableError } from './tenancy.errors';
import { TenancyEventType, DomainEvent } from './tenancy.events';

export interface SaasInvoiceLine { desc: string; qty: number; unitMinor: bigint; totalMinor: bigint; }
export interface SaasInvoiceProps {
  id: string; tenantId: string; subscriptionId: string | null; invoiceNo: string; status: InvoiceStatus;
  currencyCode: string; subtotalMinor: bigint; taxMinor: bigint; totalMinor: bigint; dueDate: string;
  paidAt: Date | null; lineItems: SaasInvoiceLine[]; dunningAttempts: number; createdAt?: Date | null;
  /** PC-56 TENANT-4d-2 — money actually RECEIVED, the SUM of this invoice's live payment rows (0092). The
   *  invoice's status is derived from it and never from a single payment amount. */
  paidMinor: bigint;
  /** The billing period a RENEWAL invoice covers (YYYYMM), or null for an invoice that covers a change
   *  rather than a period (an upgrade proration). Backs the unique index that makes the renewal run
   *  idempotent in the database instead of in a read. */
  periodTag: string | null;
  /** The tax rate in basis points ACTUALLY applied when this invoice was raised, frozen at issue. NULL =
   *  none recorded (pre-wave rows), which is not the same as a zero-rated invoice. */
  taxBp: number | null;
  /** The billed party as at issue. A later profile edit must not re-address a document already sent. */
  billToGstin: string | null;
  billToLegalName: string | null;
}

const CUR_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function assertCur(c: string): string { const s = c.toUpperCase(); if (!CUR_RE.test(s)) throw new InvalidSaasInvoiceError('currency must be ISO-4217 (3 letters)'); return s; }
function nonNeg(v: bigint, label: string): bigint { if (typeof v !== 'bigint' || v < 0n) throw new InvalidSaasInvoiceError(`${label} must be a non-negative bigint (minor units)`); return v; }

export class SaasInvoice {
  private readonly events: DomainEvent[] = [];
  private constructor(private p: SaasInvoiceProps) {}

  /** Raise a fresh invoice (status 'draft'). totals are validated: subtotal + tax === total; line totals sum to subtotal. */
  static create(input: {
    id: string; tenantId: string; subscriptionId: string | null; invoiceNo: string; currencyCode: string;
    lineItems: SaasInvoiceLine[]; taxMinor: bigint; dueDate: string;
    /** PC-56 TENANT-4d-2. All four are optional so every existing caller still compiles, and each defaults
     *  to null — "not recorded" — rather than to a value this class would have had to invent. */
    periodTag?: string | null; taxBp?: number | null; billToGstin?: string | null; billToLegalName?: string | null;
  }): SaasInvoice {
    if (!input.invoiceNo) throw new InvalidSaasInvoiceError('invoice_no is required');
    if (!DATE_RE.test(input.dueDate)) throw new InvalidSaasInvoiceError('due_date must be YYYY-MM-DD');
    if (!Array.isArray(input.lineItems) || input.lineItems.length === 0) throw new InvalidSaasInvoiceError('at least one line item is required');
    if (input.lineItems.length > 200) throw new InvalidSaasInvoiceError('too many line items (≤200)');
    let subtotal = 0n;
    for (const li of input.lineItems) {
      if (!li.desc || li.desc.length > 300) throw new InvalidSaasInvoiceError('line desc required (≤300)');
      if (!Number.isInteger(li.qty) || li.qty <= 0) throw new InvalidSaasInvoiceError('line qty must be a positive integer');
      // **A LINE MAY BE NEGATIVE (PC-56 TENANT-4d-2). THIS USED TO THROW, AND IT BROKE THE ONE INVOICE W120
      //   ACTUALLY SHOWS.** `nonNeg(li.unitMinor)` was applied to every line, while TENANT-1d-2's
      //   PlanChangeService raises its proration invoice with the unused credit as its own NEGATIVE row
      //   ("−₹5,516"), deliberately, because W119 prints the charge and the credit separately. So every
      //   mid-cycle upgrade that had any credit at all — which is every upgrade off a paid plan — threw
      //   InvalidSaasInvoiceError instead of raising an invoice. Only an upgrade with zero credit could ever
      //   have worked, which is why the proration suite (free from-plan) stayed green over it.
      //   A negative LINE is ordinary invoice grammar; a negative INVOICE is not, and is refused below.
      if (typeof li.unitMinor !== 'bigint' || typeof li.totalMinor !== 'bigint') throw new InvalidSaasInvoiceError('line amounts must be bigints (minor units)');
      if (li.unitMinor * BigInt(li.qty) !== li.totalMinor) throw new InvalidSaasInvoiceError('line total_minor must equal unit_minor × qty');
      subtotal += li.totalMinor;
    }
    // A document whose net is negative is a CREDIT NOTE, which 0140 built as its own document with its own
    // gapless series — not an invoice with a minus sign. Refused by name so a caller reaches for the right one.
    if (subtotal < 0n) throw new InvalidSaasInvoiceError('invoice subtotal is negative — a net credit is a credit note, not an invoice');
    const tax = nonNeg(input.taxMinor, 'tax_minor');
    const taxBp = input.taxBp ?? null;
    if (taxBp !== null && (!Number.isInteger(taxBp) || taxBp < 0 || taxBp > 10_000)) throw new InvalidSaasInvoiceError('tax_bp must be 0..10000 basis points');
    // A rate with no tax on a non-zero subtotal, or tax with no rate, is an invoice nobody could explain to a
    // filing officer. Caught here rather than by the CHECK, so the caller learns which half is missing.
    if (taxBp !== null && taxBp > 0 && tax === 0n && subtotal > 0n) throw new InvalidSaasInvoiceError('tax_bp is non-zero but tax_minor is zero');
    if (taxBp === 0 && tax > 0n) throw new InvalidSaasInvoiceError('tax_bp is zero but tax_minor is not');
    const period = input.periodTag ?? null;
    if (period !== null && !/^\d{6}$/.test(period)) throw new InvalidSaasInvoiceError('period_tag must be YYYYMM');
    const inv = new SaasInvoice({
      id: input.id, tenantId: input.tenantId, subscriptionId: input.subscriptionId, invoiceNo: input.invoiceNo,
      status: 'draft', currencyCode: assertCur(input.currencyCode), subtotalMinor: subtotal, taxMinor: tax,
      totalMinor: subtotal + tax, dueDate: input.dueDate, paidAt: null, lineItems: input.lineItems, dunningAttempts: 0,
      paidMinor: 0n, periodTag: period, taxBp,
      billToGstin: input.billToGstin ?? null, billToLegalName: input.billToLegalName ?? null,
    });
    return inv;
  }
  static rehydrate(p: SaasInvoiceProps): SaasInvoice { return new SaasInvoice(p); }

  get id() { return this.p.id; }
  get status() { return this.p.status; }
  get tenantId() { return this.p.tenantId; }
  get totalMinor() { return this.p.totalMinor; }
  get paidMinor() { return this.p.paidMinor; }
  get currencyCode() { return this.p.currencyCode; }
  get dueDate() { return this.p.dueDate; }
  toProps(): Readonly<SaasInvoiceProps> { return Object.freeze({ ...this.p, lineItems: [...this.p.lineItems] }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /** draft → issued: the invoice is now payable + dunnable. Emits saas_invoice_issued (→ notify the tenant). */
  issue(): void {
    assertTransition(this.p.status, 'issued');
    this.p.status = 'issued';
    this.events.push({ type: TenancyEventType.SaasInvoiceIssued, payload: { invoiceId: this.p.id, tenantId: this.p.tenantId, invoiceNo: this.p.invoiceNo, totalMinor: this.p.totalMinor.toString(), dueDate: this.p.dueDate } });
  }

  /**
   * Move this invoice to the status implied by the money ACTUALLY RECEIVED — `paidMinor`, the sum of its live
   * payment rows (0092) — as recomputed by the caller inside the same transaction as the payment insert.
   *
   * **THIS REPLACES `recordPayment(amountMinor, at)` (PC-56 TENANT-4d-2), which was wrong in a way no type
   * could catch.** That method compared ONE payment against the invoice total: two payments of half each left
   * a fully-settled invoice at `partially_paid` for ever (the second computed `partially_paid`, saw it was
   * already there, and returned false), and it never touched `paid_minor`, so the operator's collection queue
   * and the tenant's own balance disagreed by the whole invoice. The amount of a single payment cannot decide
   * an invoice's status; only the total received can.
   *
   * `pastDue` comes from the caller because the clock does not belong in a pure entity. Returns false when
   * nothing changed, so the service only writes and only audits a real transition.
   */
  applyPaidTotal(paidMinor: bigint, at: Date, pastDue: boolean): boolean {
    nonNeg(paidMinor, 'paid_minor');
    if (!acceptsPayment(this.p.status)) throw new SaasInvoiceNotPayableError(this.p.status);
    this.p.paidMinor = paidMinor;
    const to = statusFromPaid(this.p.status, this.p.totalMinor, paidMinor, pastDue);
    if (to === null) return false;
    // The one target this plane can compute but must never take is a DOWNGRADE out of `paid` — the sum fell
    // below the total, which only a reversal can cause, and reversal is god-mode (admin-api billing-ops).
    // `assertTransition` refuses it by name (SAAS_INVOICE_ILLEGAL_TRANSITION) rather than letting the tenant
    // realm quietly un-settle an invoice the operator settled.
    assertTransition(this.p.status, to);
    const from = this.p.status;
    this.p.status = to;
    // `paid_at` is the moment the invoice BECAME settled, and it is cleared when a reversal un-settles it —
    // otherwise a re-opened invoice would keep a payment date and W120 would call it "on time" for ever.
    this.p.paidAt = to === 'paid' ? at : null;
    this.events.push({ type: TenancyEventType.SaasInvoicePaid, payload: { invoiceId: this.p.id, tenantId: this.p.tenantId, status: to, statusFrom: from, paidMinor: paidMinor.toString(), totalMinor: this.p.totalMinor.toString() } });
    return true;
  }

  /** issued/partially_paid → overdue (past due_date). System/worker transition; enters the dunning queue. */
  markOverdue(): boolean {
    if (this.p.status === 'overdue') return false;
    if (this.p.status !== 'issued' && this.p.status !== 'partially_paid') return false;
    assertTransition(this.p.status, 'overdue');
    this.p.status = 'overdue';
    this.events.push({ type: TenancyEventType.SaasInvoiceOverdue, payload: { invoiceId: this.p.id, tenantId: this.p.tenantId, invoiceNo: this.p.invoiceNo } });
    return true;
  }
}
