// apps/web-tenant/src/features/billing/invoices.ts · W120's billing screen as PURE rules (PC-56 TENANT-4d-2).
// No React, no I/O — unit- and mutation-tested, and the API re-enforces every money rule server-side.

export const TABS = ['all', 'issued', 'paid', 'overdue'] as const;
export type Tab = (typeof TABS)[number];

export function isTab(v: string | undefined): v is Tab {
  return !!v && (TABS as readonly string[]).includes(v);
}

/** The tab a query string selects, defaulting to W120's own first tab rather than to whatever arrives. */
export function tabOf(raw: string | undefined): Tab {
  return isTab(raw) ? raw : 'all';
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE OPEN BALANCE                                                                                        */
/* ------------------------------------------------------------------------------------------------------- */

/** W120's headline. `mixed` is the case a single figure cannot honestly represent: open invoices in more than
 *  one currency would need an FX rate the platform does not have, so the screen lists the currencies instead
 *  of adding them. `partial` says the figure is a sum over a bounded read — never a silent truncation. */
export type BalanceState =
  | { kind: 'clear' }
  | { kind: 'open'; partial: boolean }
  | { kind: 'mixed'; currencies: string[] };

export function balanceState(v: { openBalanceMinor: string | null; openBalanceCurrencies: string[]; openInvoiceCount: number; openBalancePartial: boolean }): BalanceState {
  if (v.openBalanceMinor === null) return { kind: 'mixed', currencies: v.openBalanceCurrencies };
  if (v.openInvoiceCount === 0 || v.openBalanceMinor === '0') return { kind: 'clear' };
  return { kind: 'open', partial: v.openBalancePartial };
}

export function balanceKey(s: BalanceState): string {
  if (s.kind === 'clear') return 'bill.balance.clear';
  if (s.kind === 'mixed') return 'bill.balance.mixed';
  return s.partial ? 'bill.balance.openPartial' : 'bill.balance.open';
}

/* ------------------------------------------------------------------------------------------------------- */
/* "7 INVOICES, ALL ON TIME"                                                                               */
/* ------------------------------------------------------------------------------------------------------- */

/** THE CLAIM THE CANON MAKES, AND THE THREE IT ACTUALLY EARNS. "all on time" requires every counted invoice to
 *  be provably on time; one invoice whose payment date we do not hold makes the claim `partly unknown`, not
 *  true. A screen that rounds "we don't know" up to "all on time" is the exact defect this programme keeps
 *  finding, and it would be a claim about a tenant's own payment history. */
export function paidToDateKey(p: { invoiceCount: number; late: number; unknown: number; allOnTime: boolean }): string {
  if (p.invoiceCount === 0) return 'bill.ptd.none';
  if (p.allOnTime) return 'bill.ptd.allOnTime';
  if (p.late > 0) return 'bill.ptd.someLate';
  return 'bill.ptd.someUnknown';
}

/** A single paid row's badge. `unknown` gets its own word — it is not a quiet "on time". */
export function timelinessKey(status: string, paidAt: string | null, dueDate: string): string {
  if (status !== 'paid') return 'bill.time.na';
  if (!paidAt) return 'bill.time.unknown';
  return paidAt.slice(0, 10) <= dueDate ? 'bill.time.onTime' : 'bill.time.late';
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE TAX LINE AND THE GSTIN                                                                              */
/* ------------------------------------------------------------------------------------------------------- */

/** W120 prints "(incl. GST)". `not_recorded` must NOT render as "GST 0%": every invoice raised before this
 *  wave has no rate stored, and printing a zero rate on it would assert a zero-rated supply nobody decided. */
export function taxLineKey(taxLine: 'stated' | 'zero_rated' | 'not_recorded'): string {
  return `bill.tax.${taxLine === 'stated' ? 'stated' : taxLine === 'zero_rated' ? 'zeroRated' : 'notRecorded'}`;
}

/** "GSTIN 24AAB••••••1Z5 on every invoice" — true only of invoices that carry a snapshot. */
export function gstinKey(source: 'snapshot' | 'not_on_invoice'): string {
  return source === 'snapshot' ? 'bill.gstin.onInvoice' : 'bill.gstin.notOnInvoice';
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE FOUR MECHANISM SENTENCES — the wave's honesty surface                                               */
/* ------------------------------------------------------------------------------------------------------- */

export type MechanismVerdict = 'exists' | 'no_saas_mandate' | 'not_scheduled' | 'no_grace_state';

export const MECHANISM_ORDER = ['autopay', 'nextDebit', 'gracePeriod', 'retryAndNotify'] as const;
export type MechanismKey = (typeof MECHANISM_ORDER)[number];

/**
 * Each sentence W120 states about HOW billing works, rendered from the verdict the code can support. The canon
 * asserts a UPI autopay mandate, a next debit date, a 7-day grace period and a retry-and-notify loop; the
 * platform has none of the four. So the screen names what is missing instead of drawing a masked bank handle
 * and a date — a tenant who believes autopay is on and finds their subscription expired has been misled by
 * their own console, which is the trust cost Rule Zero forbids.
 */
export function mechanismKey(k: MechanismKey, v: MechanismVerdict): string {
  return `bill.mech.${k}.${v === 'exists' ? 'on' : 'gap'}`;
}

/** WHY it is a gap, as its own sentence. Split from the sentence above on purpose: each mechanism's gap text is
 *  specific to that mechanism ("no autopay mandate exists for SaaS billing"), while the REASON is a small shared
 *  vocabulary — so a new mechanism does not multiply the key set, and two mechanisms that are missing for the
 *  same reason say so identically. `exists` has no reason line. */
export function gapReasonKey(v: MechanismVerdict): string | null {
  if (v === 'exists') return null;
  return `bill.gap.${v === 'no_saas_mandate' ? 'noMandate' : v === 'not_scheduled' ? 'notScheduled' : 'noGrace'}`;
}

/** True when at least one mechanism sentence is a gap — the block is then shown as a notice rather than as
 *  reassuring detail. */
export function anyMechanismMissing(m: Record<MechanismKey, MechanismVerdict>): boolean {
  return MECHANISM_ORDER.some((k) => m[k] !== 'exists');
}

/* ------------------------------------------------------------------------------------------------------- */
/* PAYING AN OPEN INVOICE (W2428-W2430)                                                                    */
/* ------------------------------------------------------------------------------------------------------- */

export type PayQuote =
  | { payable: true; invoiceNo: string; amountMinor: string; currencyCode: string }
  | { payable: false; invoiceNo: string; reason: string };

/** Whether to render the button at all, and the sentence that replaces it when not. A dead button that
 *  refuses on click is worse than an absent one with a reason. */
export function payButtonKey(q: PayQuote | null): { show: boolean; key: string } {
  if (!q) return { show: false, key: 'bill.pay.noQuote' };
  if (q.payable) return { show: true, key: 'bill.pay.button' };
  const known = ['already_paid', 'voided', 'not_yet_issued', 'nothing_outstanding', 'self_pay_off'];
  const r = known.includes(q.reason) ? q.reason : 'generic';
  return { show: false, key: `bill.pay.no.${r === 'already_paid' ? 'alreadyPaid' : r === 'not_yet_issued' ? 'notIssued' : r === 'nothing_outstanding' ? 'nothingOutstanding' : r === 'self_pay_off' ? 'selfPayOff' : r}` };
}

/** THE AMOUNT NEVER COMES FROM THE FORM. The form posts an invoice id; this builds the intent from the quote
 *  the SERVER produced, and the API re-checks it against the invoice before creating a gateway order. A
 *  client that could name its own figure could open a ₹1 order against a ₹7,954 bill. */
export interface PayIntentInput { purpose: 'subscription'; amountMinor: string; currencyCode: string; referenceType: 'saas_invoice'; referenceId: string }

export function buildPayIntent(q: PayQuote, invoiceId: string): { ok: true; value: PayIntentInput } | { ok: false; error: string } {
  if (!q.payable) return { ok: false, error: q.reason };
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) return { ok: false, error: 'invoice' };
  // The server produced this figure; these two checks only stop a malformed quote reaching the gateway, they
  // are NOT the authority on the amount — the API re-derives it from total_minor − paid_minor and refuses a
  // mismatch, which is what makes tampering impossible rather than merely inconvenient.
  if (!/^[1-9]\d{0,15}$/.test(q.amountMinor)) return { ok: false, error: 'amount' };
  if (!/^[A-Z]{3}$/.test(q.currencyCode)) return { ok: false, error: 'currency' };
  return { ok: true, value: { purpose: 'subscription', amountMinor: q.amountMinor, currencyCode: q.currencyCode, referenceType: 'saas_invoice', referenceId: invoiceId } };
}

/** Every refusal these surfaces can return from the API, translated BY NAME. */
export const REFUSALS: Record<string, string> = {
  SAAS_INVOICE_NOT_FOUND: 'notFound',
  SAAS_INVOICE_ILLEGAL_TRANSITION: 'conflict',
  TENANT_FORBIDDEN: 'forbidden',
};

export function refusalKey(code: string): string {
  return `bill.err.${REFUSALS[code] ?? 'generic'}`;
}
