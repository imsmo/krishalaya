// modules/tenancy/domain/saas-invoice-balance.ts · W120's numbers as PURE arithmetic (PC-56 TENANT-4d-2).
//
// Every figure on the Billing screen is derived here from two bigints and a date, so the screen, the API and
// the payment consumer cannot disagree about what a tenant owes. No I/O, no clock of its own — `now` is always
// passed in.
//
// WHY THIS FILE EXISTS AT ALL. `SaasInvoice.recordPayment` used to compare ONE payment against the invoice
// total and type a status, ignoring `paid_minor` — the column 0092 added precisely so the balance would be a
// stored fact rather than an inference. Two half payments therefore left a fully-paid invoice stuck at
// `partially_paid` for ever. The rule below is the same one apps/admin-api's billing-ops plane already applies
// (`domain/invoice-payment.ts` → `statusAfterPayments`): status follows the SUM of the payment rows, never a
// single amount, and never an operator's or a consumer's opinion.
//
// **THE DUPLICATION IS DELIBERATE AND NAMED, NOT ACCIDENTAL.** These six lines now exist in two apps. They
// cannot be shared today: `apps/api` has no `@krishalaya/contracts` dependency, and adding one edits a
// package.json with founder work in flight. Both copies are pinned by a spec on their own side, and 0146's
// header records the unification as a decision to make once. If you are about to change a threshold here,
// change it there in the same commit or the platform will hold two beliefs about one debt.
import { InvoiceStatus, isOwing } from './saas-invoice.state';

/* ------------------------------------------------------------------------------------------------------ */
/* THE ARITHMETIC                                                                                          */
/* ------------------------------------------------------------------------------------------------------ */

/** What is still owed. Floors at zero: an overpaid invoice owes nothing, and the excess is reported
 *  separately rather than as a negative that a caller might sum into a receivables total. */
export function outstandingMinor(totalMinor: bigint, paidMinor: bigint): bigint {
  const owed = totalMinor - paidMinor;
  return owed > 0n ? owed : 0n;
}

/** The excess, when a tenant paid more than the invoice asked for. Kept visible: an overpayment that exists
 *  only as an invisible difference between two columns is money the tenant will eventually ask about. */
export function overpaidMinor(totalMinor: bigint, paidMinor: bigint): bigint {
  const excess = paidMinor - totalMinor;
  return excess > 0n ? excess : 0n;
}

/**
 * The status the invoice should now be in, given the money ACTUALLY RECEIVED (the sum of its live payment
 * rows). Returns null when nothing should change, so the caller only writes — and only audits a transition —
 * when something really moved.
 *
 * `paidMinor >= totalMinor` settles the invoice INCLUDING the overpaid case, because clamping the sum to the
 * total would destroy money the tenant sent. A fully reversed invoice goes back to being simply owed —
 * `overdue` if it is past its due date, otherwise `issued` — and the caller supplies `pastDue` because it,
 * not this function, knows the clock.
 *
 * A terminal invoice (`void`) is never moved by arithmetic: voiding is a decision, and a late payment against
 * a voided invoice is a refund conversation, not a status change.
 */
export function statusFromPaid(
  current: InvoiceStatus,
  totalMinor: bigint,
  paidMinor: bigint,
  pastDue: boolean,
): InvoiceStatus | null {
  if (current === 'void') return null;
  if (paidMinor >= totalMinor) return current === 'paid' ? null : 'paid';
  if (paidMinor > 0n) return current === 'partially_paid' ? null : 'partially_paid';
  const target: InvoiceStatus = pastDue ? 'overdue' : 'issued';
  return current === target ? null : target;
}

/** Is this invoice past its due date as at `now`? `dueDate` is a YYYY-MM-DD calendar date; comparison is on
 *  the DATE, so an invoice due today is not overdue at 00:01 in whichever timezone the caller happens to be
 *  in — the string compare is timezone-free by construction, which is why the date is never turned into a
 *  Date here. */
export function isPastDue(dueDate: string, now: Date): boolean {
  return dueDate < now.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------------------------------------------ */
/* W120's FIGURES                                                                                          */
/* ------------------------------------------------------------------------------------------------------ */

export interface InvoiceFigures {
  status: InvoiceStatus;
  totalMinor: bigint;
  paidMinor: bigint;
  dueDate: string;
  paidAt: Date | null;
  currencyCode: string;
}

/** The open balance: the sum of what is outstanding across the invoices that are still OWED. Terminal
 *  invoices contribute nothing — a voided invoice is not a debt, and a paid one owes zero anyway.
 *  Returns null where the invoices span more than one currency, because a single figure would then be a
 *  fabricated conversion (Law 2: this platform never invents a rate). The caller shows the per-currency
 *  breakdown instead of a wrong total. */
export function openBalance(rows: InvoiceFigures[]): { minor: bigint; currencyCode: string; invoiceCount: number } | { minor: null; currencies: string[] } {
  const owing = rows.filter((r) => isOwing(r.status));
  const currencies = [...new Set(owing.map((r) => r.currencyCode))];
  if (currencies.length > 1) return { minor: null, currencies: currencies.sort() };
  let sum = 0n;
  for (const r of owing) sum += outstandingMinor(r.totalMinor, r.paidMinor);
  return { minor: sum, currencyCode: currencies[0] ?? '', invoiceCount: owing.length };
}

/** W120 prints "7 invoices, all on time". "All on time" is a claim that must be earned, so a paid invoice
 *  whose payment date we do not hold is `unknown` — not on time, and not late. */
export type Timeliness = 'on_time' | 'late' | 'unknown';

export function timeliness(r: Pick<InvoiceFigures, 'status' | 'paidAt' | 'dueDate'>): Timeliness {
  if (r.status !== 'paid') return 'unknown';
  if (!r.paidAt) return 'unknown';                       // paid, but by a path that recorded no date
  return r.paidAt.toISOString().slice(0, 10) <= r.dueDate ? 'on_time' : 'late';
}

export interface PaidToDate {
  year: number;
  minor: bigint; currencyCode: string; invoiceCount: number;
  onTime: number; late: number; unknown: number;
  /** True ONLY when every counted invoice is provably on time. One `unknown` is enough to withhold it. */
  allOnTime: boolean;
  /** Set when the counted invoices span more than one currency: the figure is then per the currency named
   *  and `mixedCurrencies` lists the rest, rather than adding rupees to taka. */
  mixedCurrencies: string[];
}

/** "2026 paid to date ₹74,333 · 7 invoices, all on time" — computed from the paid invoices in a calendar
 *  year, counting the money actually RECEIVED (`paid_minor`), not the amount invoiced. Those differ whenever
 *  a tenant overpays or a payment is reversed, and the tenant's own screen should show what it actually paid. */
export function paidToDate(rows: InvoiceFigures[], year: number): PaidToDate {
  const paid = rows.filter((r) => r.status === 'paid');
  const all = [...new Set(paid.map((r) => r.currencyCode))].sort();
  const primary = all[0] ?? '';
  const counted = paid.filter((r) => r.currencyCode === primary);
  let minor = 0n; let onTime = 0, late = 0, unknown = 0;
  for (const r of counted) {
    minor += r.paidMinor;
    const t = timeliness(r);
    if (t === 'on_time') onTime++; else if (t === 'late') late++; else unknown++;
  }
  // `year` is echoed back rather than re-filtered: the repository bounded the read to it, and carrying it
  // through means the screen prints the window it was actually given instead of assuming "this year".
  return {
    year, minor, currencyCode: primary, invoiceCount: counted.length,
    onTime, late, unknown,
    allOnTime: counted.length > 0 && late === 0 && unknown === 0,
    mixedCurrencies: all.slice(1),
  };
}

/* ------------------------------------------------------------------------------------------------------ */
/* W120's TABS                                                                                             */
/* ------------------------------------------------------------------------------------------------------ */

/** W120's order, exactly. `void` is deliberately NOT a tab: it is reachable only from billing-ops and a
 *  tenant seeing a "Void" tab would reasonably ask who voided their invoice and why, which this console
 *  cannot answer. Voided invoices appear under All, labelled. */
export const INVOICE_TABS = ['all', 'issued', 'paid', 'overdue'] as const;
export type InvoiceTab = (typeof INVOICE_TABS)[number];

/** The statuses a tab covers. `issued` includes `partially_paid`, because a part-paid invoice is still an
 *  invoice awaiting payment and W120 has no fifth tab to put it in — the row carries its own status badge so
 *  the difference is never lost, only grouped. */
export function statusesForTab(tab: InvoiceTab): readonly InvoiceStatus[] | null {
  switch (tab) {
    case 'all': return null;                                       // no filter
    case 'issued': return ['issued', 'partially_paid'];
    case 'paid': return ['paid'];
    case 'overdue': return ['overdue'];
  }
}

/* ------------------------------------------------------------------------------------------------------ */
/* WHAT THE SCREEN MAY AND MAY NOT CLAIM                                                                   */
/* ------------------------------------------------------------------------------------------------------ */

/** Whether a tenant may pay this invoice itself (W2428). Each refusal is its own reason, because "you can't
 *  pay this" with no reason is the kind of dead button that generates a support ticket. */
export type PayVerdict =
  | { kind: 'payable'; amountMinor: bigint; currencyCode: string }
  | { kind: 'refused'; reason: 'already_paid' | 'voided' | 'not_yet_issued' | 'nothing_outstanding' | 'self_pay_off' };

export function payVerdict(r: InvoiceFigures, selfPayOn: boolean): PayVerdict {
  if (r.status === 'void') return { kind: 'refused', reason: 'voided' };
  if (r.status === 'paid') return { kind: 'refused', reason: 'already_paid' };
  if (r.status === 'draft') return { kind: 'refused', reason: 'not_yet_issued' };
  const owed = outstandingMinor(r.totalMinor, r.paidMinor);
  if (owed <= 0n) return { kind: 'refused', reason: 'nothing_outstanding' };
  // The flag is checked LAST so that an unpayable invoice reads as unpayable for its real reason rather
  // than as "the feature is off" — the tenant learns the true state of their bill either way.
  if (!selfPayOn) return { kind: 'refused', reason: 'self_pay_off' };
  return { kind: 'payable', amountMinor: owed, currencyCode: r.currencyCode };
}

/** The tax line. `not_recorded` is NOT "0% GST": every invoice raised before TENANT-4d-2 has no rate stored,
 *  and printing "GST 0%" on it would assert a zero-rated supply that nobody decided. */
export function taxLine(taxBp: number | null, taxMinor: bigint): 'stated' | 'zero_rated' | 'not_recorded' {
  if (taxBp === null) return 'not_recorded';
  if (taxBp === 0) return taxMinor === 0n ? 'zero_rated' : 'not_recorded';   // a rate of 0 with tax on it is incoherent
  return 'stated';
}

/** The billed GSTIN. A snapshot is a fact about the document; the tenant's CURRENT profile value is not, so
 *  where no snapshot exists the console says the invoice does not carry one rather than borrowing today's. */
export function gstinLine(snapshot: string | null): 'snapshot' | 'not_on_invoice' {
  return snapshot ? 'snapshot' : 'not_on_invoice';
}

/** Masked for display, in full in the column. Keeps the first 2 (the state code, which a tenant recognises)
 *  and the last 3, exactly as W120 renders it. Anything too short to mask is withheld entirely rather than
 *  half-shown. */
export function maskGstin(gstin: string | null): string | null {
  if (!gstin) return null;
  const s = gstin.trim();
  if (s.length < 8) return null;
  return `${s.slice(0, 2)}${'•'.repeat(Math.min(8, s.length - 5))}${s.slice(-3)}`;
}

/**
 * The four sentences W120 states about the billing MECHANISM, each with the verdict the code can actually
 * support. This is the wave's honesty surface: the canon's screen asserts an autopay mandate, a next debit
 * date, a grace period and a retry loop, and not one of them has a subject in this codebase.
 */
export type MechanismVerdict = 'exists' | 'no_saas_mandate' | 'not_scheduled' | 'no_grace_state';

export interface MechanismLines {
  /** "UPI autopay · mandate active" — the autopay plane has no notion of a subscription or a SaaS invoice. */
  autopay: MechanismVerdict;
  /** "next debit 01 Aug" — nothing schedules one: RenewalInvoicesJob is in no worker registry. */
  nextDebit: MechanismVerdict;
  /** "grace period — nothing switches off for 7 days" — `past_due` has no writer anywhere in the monorepo,
   *  and the job named for the grace period expires the subscription instead. TENANT-4d-3. */
  gracePeriod: MechanismVerdict;
  /** "while we retry and notify you" — there is no retry loop for a SaaS renewal and no dunning notice. */
  retryAndNotify: MechanismVerdict;
}

export function mechanismLines(): MechanismLines {
  return { autopay: 'no_saas_mandate', nextDebit: 'not_scheduled', gracePeriod: 'no_grace_state', retryAndNotify: 'no_grace_state' };
}

/**
 * Whether a payment row may be RECORDED against this invoice. Money that arrived is a fact, so an already
 * `paid` invoice still accepts one — that is how an overpayment stays visible (0092) instead of vanishing.
 * Only two states refuse: a `draft` was never sent to anyone, and a `void` invoice is a document we withdrew,
 * so money arriving against it is a refund conversation and must not quietly re-open it.
 */
export function acceptsPayment(status: InvoiceStatus): boolean {
  return status !== 'draft' && status !== 'void';
}
