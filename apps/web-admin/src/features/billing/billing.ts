// apps/web-admin/src/features/billing/billing.ts · PURE, framework-free helpers + types for the god-mode SaaS-
// billing console. No fetch, no React → unit-tested. The invoice state machine MIRRORS admin-api's invoice.state
// (Law 5 — the server is authoritative; this only decides which transitions to SHOW). MONEY is a bigint MINOR-UNIT
// STRING end-to-end: the adjustment amount is validated as a non-negative integer string (digits only, ≤15) and
// passed straight through — NEVER parsed to a float (Law 2). Rendered by the caller via formatMoneyMinor.

export const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'partially_paid', 'overdue', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const DUNNING_CHANNELS = ['email', 'sms', 'whatsapp', 'call', 'in_app'] as const;
export type DunningChannel = (typeof DUNNING_CHANNELS)[number];
export const DUNNING_OUTCOMES = ['sent', 'promised_pay', 'failed', 'no_response'] as const;
export type DunningOutcome = (typeof DUNNING_OUTCOMES)[number];

// Mirrors admin-api invoice.state TRANSITIONS exactly.
const TRANSITIONS: Readonly<Record<InvoiceStatus, readonly InvoiceStatus[]>> = {
  draft: ['issued', 'void'],
  issued: ['paid', 'partially_paid', 'overdue', 'void'],
  partially_paid: ['paid', 'overdue', 'void'],
  overdue: ['paid', 'partially_paid', 'void'],
  paid: [],
  void: [],
};
export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
export function isTerminal(s: InvoiceStatus): boolean { return s === 'paid' || s === 'void'; }

// The three admin-drivable UPDATE actions (PATCH invoices/:id) surfaced only when legal.
export function canIssue(s: InvoiceStatus): boolean { return s === 'draft'; }                     // → issued
export function canMarkOverdue(s: InvoiceStatus): boolean { return canTransition(s, 'overdue'); }  // issued|partially_paid
export function canVoid(s: InvoiceStatus): boolean { return canTransition(s, 'void'); }
/** Dunning is only meaningful while the invoice is still collectible. */
export function canDun(s: InvoiceStatus): boolean { return s === 'issued' || s === 'partially_paid' || s === 'overdue'; }

export function invoiceStatusKey(s: string | null | undefined): InvoiceStatus {
  return (INVOICE_STATUSES as readonly string[]).includes(s ?? '') ? (s as InvoiceStatus) : 'draft';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MINOR_RE = /^[0-9]{1,15}$/;            // non-negative integer, minor units (mirrors zod MinorUnits) — float-free
const CURRENCY_RE = /^[A-Z]{3}$/;

export function validReason(r: string | null | undefined): boolean {
  const v = (r ?? '').trim();
  return v.length >= 3 && v.length <= 1000;
}

export type AdjustmentResult =
  | { ok: true; value: { tenantId: string; direction: 'credit' | 'debit'; amountMinor: string; currency: string; reason: string; subscriptionId?: string; invoiceId?: string } }
  | { ok: false; error: 'tenantId' | 'direction' | 'amountMinor' | 'currency' | 'reason' | 'subscriptionId' | 'invoiceId' };

/** Validate + assemble the POST /billing/adjustments body (the client-supplied idempotencyKey is added by the
 *  Server Action, not here). Amount stays a minor-unit STRING — never floated. */
export function buildAdjustment(raw: { tenantId?: string; direction?: string; amountMinor?: string; currency?: string; reason?: string; subscriptionId?: string; invoiceId?: string }): AdjustmentResult {
  const tenantId = (raw.tenantId ?? '').trim();
  if (!UUID_RE.test(tenantId)) return { ok: false, error: 'tenantId' };
  const direction = (raw.direction ?? '').trim();
  if (direction !== 'credit' && direction !== 'debit') return { ok: false, error: 'direction' };
  const amountMinor = (raw.amountMinor ?? '').trim();
  if (!MINOR_RE.test(amountMinor)) return { ok: false, error: 'amountMinor' };
  const currency = ((raw.currency ?? '').trim() || 'INR').toUpperCase();
  if (!CURRENCY_RE.test(currency)) return { ok: false, error: 'currency' };
  if (!validReason(raw.reason)) return { ok: false, error: 'reason' };
  const subscriptionId = (raw.subscriptionId ?? '').trim();
  if (subscriptionId && !UUID_RE.test(subscriptionId)) return { ok: false, error: 'subscriptionId' };
  const invoiceId = (raw.invoiceId ?? '').trim();
  if (invoiceId && !UUID_RE.test(invoiceId)) return { ok: false, error: 'invoiceId' };
  return {
    ok: true,
    value: {
      tenantId, direction, amountMinor, currency, reason: (raw.reason ?? '').trim(),
      ...(subscriptionId ? { subscriptionId } : {}), ...(invoiceId ? { invoiceId } : {}),
    },
  };
}

export type DunningResult =
  | { ok: true; value: { channel: DunningChannel; outcome: DunningOutcome; note?: string } }
  | { ok: false; error: 'channel' | 'outcome' | 'note' };

/** Validate + assemble the POST /billing/invoices/:id/dunning body. */
export function buildDunning(raw: { channel?: string; outcome?: string; note?: string }): DunningResult {
  const channel = (raw.channel ?? '').trim();
  if (!(DUNNING_CHANNELS as readonly string[]).includes(channel)) return { ok: false, error: 'channel' };
  const outcome = ((raw.outcome ?? '').trim() || 'sent');
  if (!(DUNNING_OUTCOMES as readonly string[]).includes(outcome)) return { ok: false, error: 'outcome' };
  const note = (raw.note ?? '').trim();
  if (note.length > 1000) return { ok: false, error: 'note' };
  return { ok: true, value: { channel: channel as DunningChannel, outcome: outcome as DunningOutcome, ...(note ? { note } : {}) } };
}

// ---- read-model shapes (mirror admin-api billing-ops read models; type-only, no runtime) ----
export interface RevenueOverview { currency: string; mrrMinor: string; arrMinor: string; activeSubscriptions: number; outstandingMinor: string; collectedMinor: string; invoiceStatusCounts: Record<string, number> }
// PC-56 ADMIN-1: `lineItems` and `pdfMediaId` are served on the DETAIL read only (billing-ops projects them there,
// not on list pages). `lineItems` is therefore OPTIONAL rather than defaulted to []: undefined means "this read does
// not carry lines", while [] would claim the invoice bills nothing.
export interface InvoiceRow { id: string; tenantId: string; subscriptionId: string | null; invoiceNo: string; status: InvoiceStatus; currency: string; subtotalMinor: string; taxMinor: string; totalMinor: string; dueDate: string | null; paidAt: string | null; dunningAttempts: number; lastDunnedAt: string | null; createdAt: string | null; lineItems?: InvoiceLineItemRow[]; pdfMediaId?: string | null }
export interface InvoiceLineItemRow { desc: string; qty: number; unitMinor: string; totalMinor: string; hsn?: string | null; gstRatePct?: number | null }
export interface DunningAttempt { id: string; invoiceId: string; attemptNo: number; channel: string; outcome: string; note: string | null; actorUserId: string; createdAt: string | null }
export interface Adjustment { id: string; tenantId: string; subscriptionId: string | null; invoiceId: string | null; direction: string; amountMinor: string; currency: string; reason: string; walletTxnId: string; createdAt: string | null }
