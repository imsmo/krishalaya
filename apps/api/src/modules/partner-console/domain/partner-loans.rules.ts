// modules/partner-console/domain/partner-loans.rules.ts · PC-56 PARTNER-4a · THE LENDER READS ITS OWN BOOK — FACTS, NEVER A BORROWER — the
// PURE pieces (no I/O).
//
// Founder 4a-2 (2026-10-28): a lender sees LOAN FACTS on ITS OWN BOOK only — the loan reference (its id: there is no loan number), the
// application reference (likewise — `loan_applications.partner_app_ref` is never written), the product and its `loan_kind` CODE (or "not
// recorded"), the cooperative's PUBLIC name, the principal, the rate in INTEGER BASIS POINTS, the disbursal date, the status, the
// outstanding, and per repayment the due date, both amounts and the date paid. NEVER `borrower_user_id` or a name, never the repayment
// `channel`, never a bank account, never a drawl narrative, never a milk-bill figure, never a herd claim, never a ledger transaction id,
// never `created_by` / `updated_by` / `origination_fee_txn_id`, never the application's purpose text or decision note, never the FPO's
// tenant id. 0231's definers never return those columns, and 0231's COLUMN GRANTS mean a widened query cannot even read them (42501);
// `projectLoan` / `projectRepayment` below are the THIRD wall: they BUILD each output field by field from an allow-list, so an identity
// column that ever reached a row (a definer widened by mistake — mutants M3 / M7) still cannot reach a response.
// The console never returns a loan's `tenantId`: the FPO is named by its public display name only, in the field `fpoName` (survey F-10).
//
// Money: bigint minor-unit STRINGS (Law 2). Rates: INTEGER BASIS POINTS, never a float percentage (the 2c rule, founder 4a-7). Counts:
// integers. **No function in this file can emit a `%`** — there is no ratio, no rate, no average and no PAR anywhere on the lender's book
// (founder 4a-5: a percentage over a book whose due dates are all NULL would be a lie either way; survey E9).
// The FY window is reused from PARTNER-3a's `partner-claims.rules.ts` (`FY_WINDOW_SQL`, `fyWindow`, `fyLabel`, `validWindow`) — one rule,
// one place.
import { pgDateOrNull } from '../../../core/database/pg-date';
import { FY_TIME_ZONE, fyLabel } from './partner-claims.rules';
// The FY window is PARTNER-3a's, unchanged — re-exported so the loans service reads one rule from one place.
export { FY_WINDOW_SQL, FY_TIME_ZONE, fyWindow, fyLabel, validWindow } from './partner-claims.rules';

/**
 * The loan statuses a lender may filter its book by. `loan_status` (0011:15) holds SIX values; the platform can
 * produce FIVE of them: the state machine wires four (`fintech/domain/loan.state.ts`) and `restructured` is reached
 * through the servicing plane's own UPDATE. **`transferred` has NO WRITER anywhere and is refused by name** (survey
 * §1E; SEC §5 residual 5 — who owns a transferred loan — is still unanswered), so it is not offered as a filter and
 * a loan carrying it would print as an unknown status rather than as a state this platform claims to support.
 */
export const PARTNER_LOAN_STATUSES = ['active', 'overdue', 'restructured', 'closed', 'written_off'] as const;
export type PartnerLoanStatus = (typeof PARTNER_LOAN_STATUSES)[number];
export const isPartnerLoanStatus = (v: unknown): v is PartnerLoanStatus =>
  typeof v === 'string' && (PARTNER_LOAN_STATUSES as readonly string[]).includes(v);
/** The status refused by name: it exists in the enum and nothing writes it. */
export const REFUSED_LOAN_STATUS = 'transferred';
/** A loan is still being serviced while it is active or overdue — the two statuses the outstanding headline counts. */
export const SERVICING_LOAN_STATUSES: readonly PartnerLoanStatus[] = ['active', 'overdue'];

/**
 * The NINE platform `loan_kind` codes (seed core/0005:53). `0011:59`'s comment also names `jlg`, `modular`, `solar`
 * and `invoice_discount`, which are **never seeded** — the canon's "13 kinds" is false and was already recorded at
 * PARTNER-2. A kind id that does not resolve to a platform value answers NULL → `not_recorded`.
 */
export const LOAN_KIND_CODES = ['kcc', 'crop', 'tractor', 'dairy', 'whr', 'gold', 'bnpl', 'shg', 'tenant_wc'] as const;
export const NOT_RECORDED = 'not_recorded';

/** Property names that never leave the lender's book read (the borrower, the channel, the people who wrote the row). */
export const LOAN_PERSON_FIELDS = Object.freeze([
  'borrowerUserId', 'borrower_user_id', 'borrower', 'channel', 'repaymentChannel', 'repayment_channel',
  'createdBy', 'created_by', 'updatedBy', 'updated_by', 'originationFeeTxnId', 'origination_fee_txn_id',
  'tenantId', 'tenant_id', 'purposeText', 'purpose_text', 'decisionNote', 'decision_note',
  'applicantUserId', 'applicant_user_id', 'phone', 'name', 'narrative', 'ledgerTxnId', 'ledger_txn_id',
  'bankAccount', 'bank_account', 'destinationKind', 'destination_kind', 'creditScoreId', 'credit_score_id',
] as const);

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const int = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? ''));
  return Number.isInteger(n) ? n : 0;
};
const minor = (v: unknown): string => {
  const s = String(v ?? '');
  return /^-?\d+$/.test(s) ? BigInt(s).toString() : '0';
};
const minorOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return /^-?\d+$/.test(s) ? BigInt(s).toString() : null;
};

export interface PartnerLoanView {
  /** The loan's id — the loan REFERENCE (there is no loan number on the platform; the console prints its short form). */
  id: string;
  /** The application's id — its REFERENCE (`partner_app_ref` is never written, so there is no human-readable number). */
  applicationId: string;
  productId: string;
  productName: string | null;
  /** A platform `loan_kind` code (kcc, crop, dairy …), or null: "not recorded". */
  kindCode: string | null;
  /** The FPO's PUBLIC display name (0204's `public_tenant_profile`), or null for a non-live organisation — never its id. */
  fpoName: string | null;
  /** bigint minor-unit string (Law 2). */
  principalMinor: string;
  /** INTEGER basis points, stamped at disbursal — the one place a loan's terms are snapshotted. Never a percentage. */
  interestAprBps: number;
  disbursedAt: string | null;
  /** NULL on every loan both rails open (survey F-8): the console prints "no maturity date recorded". */
  maturityDate: string | null;
  status: string;
  outstandingMinor: string;
  /** NULL likewise: the console prints "no next due date recorded". There is no instalment schedule on this platform. */
  nextDueDate: string | null;
  openedAt: string | null;
  lastChangedAt: string | null;
}

/** One loan row (as 0231's definer answers it, snake or camel) → the view. Field by field from the allow-list; nothing else passes. */
export function projectLoan(row: Record<string, unknown>, names: { fpoName: string | null }): PartnerLoanView {
  return {
    id: String(row.id),
    applicationId: String(row.application_id ?? row.applicationId ?? ''),
    productId: String(row.product_id ?? row.productId ?? ''),
    productName: str(row.product_name ?? row.productName),
    kindCode: str(row.kind_code ?? row.kindCode),
    fpoName: names.fpoName,
    principalMinor: minor(row.principal_minor ?? row.principalMinor),
    interestAprBps: int(row.interest_apr_bps ?? row.interestAprBps),
    disbursedAt: pgDateOrNull(row.disbursed_at ?? row.disbursedAt),
    maturityDate: pgDateOrNull(row.maturity_date ?? row.maturityDate),
    status: String(row.status ?? ''),
    outstandingMinor: minor(row.outstanding_minor ?? row.outstandingMinor),
    nextDueDate: pgDateOrNull(row.next_due_date ?? row.nextDueDate),
    openedAt: str(row.created_us) ?? iso(row.created_at ?? row.createdAt),
    lastChangedAt: iso(row.updated_at ?? row.updatedAt),
  };
}

export interface PartnerRepaymentView {
  id: string;
  loanId: string;
  /** The recorded due date. A row is created AT PAYMENT with `due_date = now()`, so this is NOT an instalment date and
   *  nothing here can be called "on time" (founder 4a-5 refuses every on-time figure by name). */
  dueDate: string | null;
  amountDueMinor: string;
  amountPaidMinor: string;
  paidAt: string | null;
  recordedAt: string | null;
}

/** One repayment row → the view. The `channel` is not in 0231's definer, not in the grant, and not built here (mutant M7). */
export function projectRepayment(row: Record<string, unknown>): PartnerRepaymentView {
  return {
    id: String(row.id),
    loanId: String(row.loan_id ?? row.loanId ?? ''),
    dueDate: pgDateOrNull(row.due_date ?? row.dueDate),
    amountDueMinor: minor(row.amount_due_minor ?? row.amountDueMinor),
    amountPaidMinor: minor(row.amount_paid_minor ?? row.amountPaidMinor),
    paidAt: iso(row.paid_at ?? row.paidAt),
    recordedAt: str(row.created_us) ?? iso(row.created_at ?? row.createdAt),
  };
}

// ── the counts (COUNTS and bigint SUMS; never a ratio, never a percentage) ───────────────────────────────────────
/** One row of `partner_loan_counts(from, to)` on one shard. */
export interface LoanCountRow { kind_code: string | null; status: string; n: string | number; outstanding_minor: string | number; principal_minor: string | number }

export interface PartnerLoanCounts {
  /** The window: IST calendar days, [from, to) — the loans OPENED in it. */
  from: string; to: string; timeZone: string;
  /** "2026-27" when the window is an FY, else null. */
  fy: string | null;
  /** How many loans were opened in the window. */
  total: number;
  /** Every status the platform can produce, 0 when none (`transferred` is refused by name and is not a key). */
  byStatus: Record<string, number>;
  /** By platform `loan_kind` code, plus `not_recorded` — 0 when none. */
  byKind: Record<string, number>;
  /** Σ outstanding and Σ principal per `loan_kind` code, as bigint minor-unit STRINGS. */
  outstandingByKindMinor: Record<string, string>;
  principalByKindMinor: Record<string, string>;
  /** Σ outstanding over the SERVICING statuses (active + overdue) and the count of them — the two figures of the
   *  canon's "Outstanding · N active" headline, for the loans OPENED in this window. Never an average, never a ratio. */
  servicing: { count: number; outstandingMinor: string };
  /** The decided counts the canon asks for as rates (founder 4a-7 / survey E9: counts, never a share of the book). */
  restructured: number;
  writtenOff: { count: number; outstandingMinor: string };
  computedAt: string;
}

const addMinor = (a: string, b: unknown): string => (BigInt(a) + BigInt(minor(b))).toString();

/** Merge the shards' rows: counts and bigint sums add; every producible status present; an unresolved kind counts as not recorded. */
export function mergeLoanCounts(rows: readonly LoanCountRow[], window: { from: string; to: string }, computedAt: string): PartnerLoanCounts {
  const byStatus: Record<string, number> = Object.fromEntries(PARTNER_LOAN_STATUSES.map((s) => [s, 0]));
  const byKind: Record<string, number> = { [NOT_RECORDED]: 0 };
  const outstandingByKindMinor: Record<string, string> = { [NOT_RECORDED]: '0' };
  const principalByKindMinor: Record<string, string> = { [NOT_RECORDED]: '0' };
  for (const k of LOAN_KIND_CODES) { byKind[k] = 0; outstandingByKindMinor[k] = '0'; principalByKindMinor[k] = '0'; }
  let total = 0;
  let servicingCount = 0; let servicingOutstanding = '0';
  let restructured = 0; let writtenOffCount = 0; let writtenOffOutstanding = '0';
  for (const r of rows) {
    const n = Number(r.n);
    if (!Number.isInteger(n) || n < 0) continue;
    total += n;
    if (isPartnerLoanStatus(r.status)) byStatus[r.status] += n;
    const code = r.kind_code && /^[a-z][a-z0-9_]{0,59}$/.test(r.kind_code) ? r.kind_code : NOT_RECORDED;
    byKind[code] = (byKind[code] ?? 0) + n;
    outstandingByKindMinor[code] = addMinor(outstandingByKindMinor[code] ?? '0', r.outstanding_minor);
    principalByKindMinor[code] = addMinor(principalByKindMinor[code] ?? '0', r.principal_minor);
    if (isPartnerLoanStatus(r.status) && SERVICING_LOAN_STATUSES.includes(r.status)) {
      servicingCount += n; servicingOutstanding = addMinor(servicingOutstanding, r.outstanding_minor);
    }
    if (r.status === 'restructured') restructured += n;
    if (r.status === 'written_off') { writtenOffCount += n; writtenOffOutstanding = addMinor(writtenOffOutstanding, r.outstanding_minor); }
  }
  return {
    from: window.from, to: window.to, timeZone: FY_TIME_ZONE, fy: fyLabel(window.from, window.to), total,
    byStatus, byKind, outstandingByKindMinor, principalByKindMinor,
    servicing: { count: servicingCount, outstandingMinor: servicingOutstanding },
    restructured, writtenOff: { count: writtenOffCount, outstandingMinor: writtenOffOutstanding },
    computedAt,
  };
}
