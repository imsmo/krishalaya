// apps/admin-api/src/modules/billing-ops/domain/invoice.entity.ts · the SaaS-invoice aggregate (pure, no I/O).
// Holds the money as bigint MINOR UNITS (Law 2) and is the only place status changes are applied — always via
// the state machine. The console drives issue()/void()/markOverdue(); paid/partially_paid come from payments.
import { InvoiceStatus, assertTransition, assertReconciliation } from './invoice.state';

export interface InvoiceProps {
  id: string;
  tenantId: string;
  subscriptionId: string | null;
  invoiceNo: string;
  status: InvoiceStatus;
  currencyCode: string;
  subtotalMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  dueDate: string | Date;
  paidAt: Date | null;
  dunningAttempts: number;
  lastDunnedAt: Date | null;
  createdAt?: Date | null;
  // PC-56 ADMIN-1. Both columns have existed on `saas_invoices` since 0002 and were simply never projected, so the
  // console could show a total but not WHAT WAS BILLED — an invoice a finance officer cannot itemise is not an
  // invoice, and neither is one whose PDF (the artefact the tenant actually received) is unreachable.
  // Line items are read-only here: they are produced by the billing cycle, never edited by an admin.
  lineItems?: InvoiceLineItem[];
  pdfMediaId?: string | null;
}

/** One billed line, exactly as `saas_invoices.line_items` stores it (0002 line 184). Every money field is a bigint
 *  MINOR-UNIT STRING on the wire (Law 2) and `gstRatePct` is the statutory rate as recorded — the console displays
 *  these, and computes nothing: a client-side re-derivation of GST that disagreed with the filed invoice would be a
 *  tax discrepancy, not a rounding difference. `hsn` may be absent on non-goods lines (a SaaS subscription is a
 *  service), which is why it is optional rather than defaulted to a plausible-looking code. */
export interface InvoiceLineItem {
  desc: string;
  qty: number;
  unitMinor: string;
  totalMinor: string;
  hsn?: string | null;
  gstRatePct?: number | null;
}

/** Parse the jsonb payload defensively: a malformed or partial row is DROPPED rather than rendered with zeros,
 *  because a line reading "₹0.00" is a worse lie than a line that is visibly missing (and the subtotal, which comes
 *  from the invoice's own column, will not match the visible lines — which is exactly the signal finance needs). */
export function parseLineItems(raw: unknown): InvoiceLineItem[] {
  if (!Array.isArray(raw)) return [];
  const out: InvoiceLineItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const desc = typeof o.desc === 'string' ? o.desc.trim() : '';
    const unit = money(o.unit_minor ?? o.unitMinor);
    const total = money(o.total_minor ?? o.totalMinor);
    if (!desc || unit === null || total === null) continue;
    const qtyRaw = Number(o.qty);
    const gstRaw = Number(o.gst_rate ?? o.gstRate ?? o.gstRatePct);
    out.push({
      desc, qty: Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1,
      unitMinor: unit, totalMinor: total,
      hsn: typeof o.hsn === 'string' && o.hsn.trim() ? o.hsn.trim() : null,
      gstRatePct: Number.isFinite(gstRaw) ? gstRaw : null,
    });
  }
  return out;
}
function money(v: unknown): string | null {
  const s = typeof v === 'bigint' || typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  return /^-?\d{1,20}$/.test(s) ? s : null;
}

export interface StatusChange { from: InvoiceStatus; to: InvoiceStatus; }

export class SaasInvoice {
  private constructor(private p: InvoiceProps) {}
  static rehydrate(p: InvoiceProps): SaasInvoice { return new SaasInvoice(p); }

  get status(): InvoiceStatus { return this.p.status; }
  get tenantId(): string { return this.p.tenantId; }
  get dunningAttempts(): number { return this.p.dunningAttempts; }

  private to(next: InvoiceStatus): StatusChange {
    const from = this.p.status;
    assertTransition(from, next);          // throws IllegalInvoiceTransitionError
    this.p.status = next;
    return { from, to: next };
  }

  /** draft → issued (the invoice is now payable + dunnable). */
  issue(): StatusChange { return this.to('issued'); }
  /** issued/partially_paid → overdue (past due_date, enters the dunning queue). */
  markOverdue(): StatusChange { return this.to('overdue'); }
  /** → void: write-off / cancellation (terminal). Reason is recorded by the service in the audit row. */
  void(): StatusChange { return this.to('void'); }

  /** PC-56 ADMIN-1b · move the invoice because the RECORDED PAYMENTS say so (0092). Uses the reconciliation table,
   *  not the operator table — that is what lets a reversal reopen a settled invoice while still making it impossible
   *  for arithmetic to void one. Never call this with a status an operator typed; it is only ever the output of
   *  `statusAfterPayments`. */
  reconcileTo(next: InvoiceStatus): StatusChange {
    const from = this.p.status;
    assertReconciliation(from, next);
    this.p.status = next;
    return { from, to: next };
  }

  toJSON() {
    return {
      id: this.p.id, tenantId: this.p.tenantId, subscriptionId: this.p.subscriptionId, invoiceNo: this.p.invoiceNo,
      status: this.p.status, currency: this.p.currencyCode,
      subtotalMinor: this.p.subtotalMinor.toString(), taxMinor: this.p.taxMinor.toString(), totalMinor: this.p.totalMinor.toString(),
      dueDate: this.p.dueDate, paidAt: this.p.paidAt, dunningAttempts: this.p.dunningAttempts, lastDunnedAt: this.p.lastDunnedAt,
      createdAt: this.p.createdAt ?? null,
      // absent (not []) on list rows: an empty array would claim "this invoice bills nothing", while undefined
      // honestly says "the list does not carry lines — open the invoice".
      lineItems: this.p.lineItems, pdfMediaId: this.p.pdfMediaId ?? null,
    };
  }
}
