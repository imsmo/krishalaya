// apps/web-partner/src/features/lending/application.ts · PURE helpers for the lender loan-application flow. Mirrors
// the apps/api fintech loan-application state machine EXACTLY (loan-application.state.ts):
//   draft → submitted → under_review → approved → disbursed   (+ rejected from review; withdrawn by applicant)
// No I/O, no React. Money is bigint MINOR-UNIT strings (Law 2): the approved amount is entered as whole rupees and
// converted to paise with BigInt (never a float multiply), avoiding the float-coercion helpers the §4 audit forbids.

export const APP_STATUSES = ['draft', 'submitted', 'under_review', 'approved', 'rejected', 'withdrawn', 'disbursed'] as const;
export type AppStatus = (typeof APP_STATUSES)[number];

const TRANSITIONS: Record<AppStatus, readonly AppStatus[]> = {
  draft: ['submitted', 'withdrawn'],
  submitted: ['under_review', 'withdrawn'],
  under_review: ['approved', 'rejected'],
  approved: ['disbursed', 'withdrawn'],
  rejected: [],
  withdrawn: [],
  disbursed: [],
};

export function isAppStatus(v: string): v is AppStatus {
  return (APP_STATUSES as readonly string[]).includes(v);
}
export function canTransition(from: AppStatus, to: AppStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
export function isTerminal(s: AppStatus): boolean {
  return s === 'rejected' || s === 'withdrawn' || s === 'disbursed';
}

// ---- lender decision gates (only the action legal for the current status is offered) ----------------------------
/** A lender begins review on a freshly submitted application (submitted → under_review). */
export function canReview(s: AppStatus): boolean { return s === 'submitted'; }
/** Approve / reject are only legal while under review. */
export function canApprove(s: AppStatus): boolean { return s === 'under_review'; }
export function canReject(s: AppStatus): boolean { return s === 'under_review'; }
// PC-56 PARTNER-4a (survey F-14 / C-19): `canDisburse` is GONE. A partner never disburses — the API refuses it by
// name (`PARTNER_CANNOT_DISBURSE`) and the SDK's own `disburse()` throws after the 403. The helper was referenced
// only by its own spec case, and the three shipped sentences that offered the act (`loan.disburseSubmit`,
// `loan.disburseHint`, `loan.ok.disburse`) are deleted with it; the `loan.` prefix is now inside the guard's scope,
// so they cannot come back silently.

export function statusKey(status: string): string {
  return isAppStatus(status) ? `loan.st.${status}` : 'loan.st.unknown';
}
export function statusTone(status: string): 'ok' | 'warn' | 'info' | 'danger' | 'muted' {
  if (status === 'approved' || status === 'disbursed') return 'ok';
  if (status === 'submitted') return 'warn';
  if (status === 'under_review') return 'info';
  if (status === 'rejected') return 'danger';
  return 'muted'; // draft / withdrawn / unknown
}

// ---- money: ₹ whole rupees → paise minor-unit string (BigInt, float-free) ---------------------------------------
const RUPEES_RE = /^\d{1,13}$/;
const HOURS_RE = /^\d{1,4}$/;

export class LendingError extends Error {
  constructor(public readonly fieldKey: string) { super(fieldKey); this.name = 'LendingError'; }
}

/** Convert a whole-rupee string to a paise minor-unit string (× 100 via BigInt — never a float). */
export function rupeesToPaiseMinor(rawRupees: string): string {
  const v = (rawRupees ?? '').trim();
  if (!RUPEES_RE.test(v)) throw new LendingError('badAmount');
  return (BigInt(v) * 100n).toString();
}

export interface ApproveBody { amountApprovedMinor: string; coolingOffHours: number; }
/** Build the approve body: amount → paise (BigInt), cooling-off window an integer 0..720 hours (default 24). */
export function buildApprove(rawRupees: string, rawHours: string | undefined): ApproveBody {
  const amountApprovedMinor = rupeesToPaiseMinor(rawRupees);
  const h = (rawHours ?? '').trim();
  let coolingOffHours = 24;
  if (h.length > 0) {
    if (!HOURS_RE.test(h)) throw new LendingError('badAmount');
    const n = +h; // safe: digits only
    if (n > 720) throw new LendingError('badAmount');
    coolingOffHours = n;
  }
  return { amountApprovedMinor, coolingOffHours };
}

export interface RejectBody { note?: string; }
/** Build the reject body: an optional decision note (≤ 500 chars). */
export function buildReject(rawNote: string | undefined): RejectBody {
  const note = (rawNote ?? '').trim();
  if (note.length === 0) return {};
  if (note.length > 500) throw new LendingError('reason');
  return { note };
}

// ---- queue filters -------------------------------------------------------------------------------------------
// PC-56 PARTNER-4a: the queue's boxes, its status filter, its links and its row model now live where the page that
// prints them lives — features/partner4/figures.ts (`QUEUE_BOXES`, `queueQuery`, `queueHref`, `boxKey`) at the
// canon's address `/lender/queue` — and `features/partner/application.ts` keeps `partnerListFilter`, which turns a
// box into the partner read's filter. `LENDER_BOXES`, `isLenderBox`, `boxKey`, `buildListQuery`, `queueHref` and the
// unread `AppRow` / `AppDetail` types are GONE from here: every one of them had no consumer left but its own spec
// case once the pages moved, which is the same residue this wave deleted everywhere else (survey F-14).
