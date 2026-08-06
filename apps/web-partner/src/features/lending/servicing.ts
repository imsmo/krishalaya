// apps/web-partner/src/features/lending/servicing.ts · PURE post-disbursal servicing rules (PC-55 B7, on W54-8).
// Framework-free mirrors of modules/fintech/services/servicing.service.ts, so the console offers only what the API
// will accept — and, more importantly, so the three places where a wrong click costs a borrower real money are
// unit-provable.
//
// THE THREE THINGS THIS FILE PROTECTS:
//   1. A KCC LEDGER ENTRY IS SIGNED BY ITS KIND, NEVER BY THE OPERATOR. A drawl and an interest posting ADD to the
//      drawn balance; a repayment SUBTRACTS. The console never sends a negative number and never computes the
//      running balance — the server does that under a row lock, and a repayment that would push the balance below
//      zero is refused there. What the console must get right is the KIND, so the sign is never a typo.
//   2. MAKER ≠ CHECKER ON A RESTRUCTURE. `checker_approved` is refused server-side when the approver is the
//      proposer. The console therefore HIDES that step from the proposer instead of letting them click it and read
//      a 403 — the point of maker-checker is that two people looked, and a UI that invites one person to try both
//      teaches them the control is a formality.
//   3. A WRITE-OFF IS ONLY FROM OVERDUE, AND ALWAYS WITH A WRITTEN REASON. Writing off a loan ends a borrower's
//      obligation on the platform's books; a blank reason would leave nobody able to explain it later.

// ---------------------------------------------------------------------------
// DPD buckets + collections queue (reads)
// ---------------------------------------------------------------------------
export interface DpdBucketRow { bucket?: string | null; loans?: number | null; outstandingMinor?: string | null }

/** The canonical DPD ladder, worst first. The API groups by these buckets; ordering them here means a lender always
 *  reads the most dangerous row at the top rather than in whatever order SQL returned. */
export const DPD_ORDER = ['180+', '90-179', '60-89', '30-59', '1-29', 'current'] as const;

export function dpdRank(bucket: string | null | undefined): number {
  const i = (DPD_ORDER as readonly string[]).indexOf(String(bucket ?? ''));
  return i === -1 ? DPD_ORDER.length : i;   // an unknown bucket sorts LAST, never silently first
}
export function sortDpd<T extends DpdBucketRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => dpdRank(a.bucket) - dpdRank(b.bucket));
}
/** NPA convention (RBI): 90 days past due and beyond. Used only to LABEL a row — never to compute a provision,
 *  which is the lender's own regulated calculation and not this console's business. */
export function isNpaBucket(bucket: string | null | undefined): boolean {
  return bucket === '90-179' || bucket === '180+';
}
/** Total loans across buckets, summed from what the API actually returned (no invented buckets). */
export function totalLoans(rows: readonly DpdBucketRow[]): number {
  return rows.reduce((n, r) => n + (Number.isFinite(Number(r.loans)) ? Number(r.loans) : 0), 0);
}

// ---------------------------------------------------------------------------
// The KCC drawl ledger
// ---------------------------------------------------------------------------
export const KCC_ENTRY_KINDS = ['drawl', 'repayment', 'interest'] as const;
export type KccEntryKind = (typeof KCC_ENTRY_KINDS)[number];
export function isKccEntryKind(v: string | undefined | null): v is KccEntryKind {
  return !!v && (KCC_ENTRY_KINDS as readonly string[]).includes(v);
}

/** Which direction this kind moves the drawn balance. Mirrors the server exactly: repayment is the only negative. */
export function kccSign(kind: KccEntryKind): 1 | -1 { return kind === 'repayment' ? -1 : 1; }

export const REPAYMENT_CHANNELS = ['upi', 'milk_bill_deduction', 'harvest_settlement', 'cash_partner'] as const;
export const DESTINATION_KINDS = ['supplier_direct', 'other'] as const;

export type DestinationKind = (typeof DESTINATION_KINDS)[number];
export type RepaymentChannel = (typeof REPAYMENT_CHANNELS)[number];
export interface KccEntryInput {
  entryKind: KccEntryKind; amountMinor: string; narrative: string;
  destinationKind?: DestinationKind; repaymentChannel?: RepaymentChannel;
}
export type KccError = 'kind' | 'amount' | 'narrative' | 'channel' | 'destination';
export type KccResult = { ok: true; value: KccEntryInput } | { ok: false; error: KccError };

/** Build a KCC entry. The AMOUNT IS ALWAYS POSITIVE here — the kind carries the sign, server-side. A narrative is
 *  required because a KCC ledger is read years later by people who were not in the room: "drawl 20000" with no
 *  purpose is a number nobody can defend at an audit. */
export function buildKccEntry(raw: {
  entryKind: string; amountMajor: string; narrative: string; destinationKind: string; repaymentChannel: string;
}, toMinor: (major: string) => string | undefined): KccResult {
  if (!isKccEntryKind(raw.entryKind)) return { ok: false, error: 'kind' };
  const amountMinor = toMinor(raw.amountMajor.trim());
  if (!amountMinor || amountMinor === '0' || !/^\d{1,15}$/.test(amountMinor)) return { ok: false, error: 'amount' };
  const narrative = raw.narrative.trim();
  if (narrative.length < 3 || narrative.length > 500) return { ok: false, error: 'narrative' };

  const value: KccEntryInput = { entryKind: raw.entryKind, amountMinor, narrative };
  const channel = raw.repaymentChannel.trim();
  if (channel) {
    if (raw.entryKind !== 'repayment') return { ok: false, error: 'channel' };   // a drawl has no repayment channel
    if (!(REPAYMENT_CHANNELS as readonly string[]).includes(channel)) return { ok: false, error: 'channel' };
    value.repaymentChannel = channel as RepaymentChannel;
  }
  const destination = raw.destinationKind.trim();
  if (destination) {
    if (raw.entryKind !== 'drawl') return { ok: false, error: 'destination' };   // only a drawl goes somewhere
    if (!(DESTINATION_KINDS as readonly string[]).includes(destination)) return { ok: false, error: 'destination' };
    value.destinationKind = destination as DestinationKind;
  }
  return { ok: true, value };
}

/** How a ledger row should read. The API returns the SIGNED amount and the balance it produced, so the console
 *  displays both rather than re-deriving either — a locally recomputed balance that disagreed with the server's
 *  would be the worst possible thing to show a borrower. */
export function kccRowDirection(amountMinor: string | null | undefined): 'in' | 'out' | 'unknown' {
  const s = String(amountMinor ?? '').trim();
  if (!s) return 'unknown';
  return s.startsWith('-') ? 'out' : 'in';
}
/** Strip the sign for display; the direction is shown as a label, not as a minus buried in a money string. */
export function absMinor(amountMinor: string | null | undefined): string {
  const s = String(amountMinor ?? '').trim();
  return s.startsWith('-') ? s.slice(1) : s;
}

// ---------------------------------------------------------------------------
// Restructures — the maker-checker wizard
// ---------------------------------------------------------------------------
export const RESTRUCTURE_STATUSES = ['draft', 'mediation', 'accepted', 'checker_approved', 'activated', 'rejected', 'expired'] as const;
export type RestructureStatus = (typeof RESTRUCTURE_STATUSES)[number];

/** The server's flow, copied exactly (servicing.service.ts RESTRUCTURE_FLOW). */
const FLOW: Readonly<Record<RestructureStatus, readonly RestructureStatus[]>> = Object.freeze({
  draft: ['mediation', 'rejected'],
  mediation: ['accepted', 'rejected', 'expired'],
  accepted: ['checker_approved', 'rejected'],
  checker_approved: ['activated', 'rejected'],
  activated: [],
  rejected: [],
  expired: [],
});

export function isRestructureStatus(v: string | undefined | null): v is RestructureStatus {
  return !!v && (RESTRUCTURE_STATUSES as readonly string[]).includes(v);
}

/** The transitions to OFFER. `checker_approved` is withheld from the proposer, because the API refuses it and
 *  because offering it would misrepresent what maker-checker is for. Everything else follows the flow. */
export function offeredTransitions(status: string | null | undefined, viewerUserId: string | null | undefined, proposedBy: string | null | undefined): RestructureStatus[] {
  if (!isRestructureStatus(status)) return [];
  const next = [...(FLOW[status] ?? [])];
  const isProposer = !!viewerUserId && viewerUserId === proposedBy;
  return next.filter((to) => !(to === 'checker_approved' && isProposer));
}

/** True when this restructure is waiting for a SECOND person — the state a console should make visible, since a
 *  case parked here is a borrower waiting on an internal handoff. */
export function awaitingChecker(status: string | null | undefined): boolean { return status === 'accepted'; }

export const RESTRUCTURE_REASONS = ['weather_distress', 'other'] as const;

export interface RestructureInput {
  reasonCode: 'weather_distress' | 'other';
  oldInstalmentMinor: string; newInstalmentMinor: string;
  oldTenorMonths: number; newTenorMonths: number; rateAprBps: number;
  totalInterestDeltaMinor: string;
  caseRef?: string; holidayMonths?: number; holidayStartsOn?: string; penalInterestWaived?: boolean;
}
export type RestructureError =
  | 'reason' | 'oldInstalment' | 'newInstalment' | 'oldTenor' | 'newTenor' | 'rate' | 'rateChanged'
  | 'interestDelta' | 'holidayMonths' | 'holidayStartsOn' | 'caseRef' | 'noRelief';
export type RestructureResult = { ok: true; value: RestructureInput } | { ok: false; error: RestructureError };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Build the restructure proposal.
 *  THE DOCTRINE (canon W220, and the reason `rateAprBps` is sent at all): a restructure re-shapes the SCHEDULE — a
 *  smaller instalment, a longer tenor, perhaps a payment holiday — it does NOT re-price the loan. So the rate must
 *  equal the loan's current rate, and a form that changed it is refused HERE with a plain explanation rather than
 *  producing a proposal that quietly repriced a distressed borrower's debt.
 *  And a proposal must actually RELIEVE something: a lower instalment, a longer tenor, or a holiday. Otherwise it is
 *  paperwork that resets a delinquency clock without helping anybody. */
export function buildRestructure(raw: {
  reasonCode: string; oldInstalmentMajor: string; newInstalmentMajor: string;
  oldTenorMonths: string; newTenorMonths: string; rateAprBps: string; currentRateAprBps: number;
  totalInterestDeltaMajor: string; caseRef: string; holidayMonths: string; holidayStartsOn: string; penalInterestWaived: boolean;
}, toMinor: (major: string) => string | undefined): RestructureResult {
  if (!(RESTRUCTURE_REASONS as readonly string[]).includes(raw.reasonCode)) return { ok: false, error: 'reason' };

  const oldInstalmentMinor = toMinor(raw.oldInstalmentMajor.trim());
  if (!oldInstalmentMinor) return { ok: false, error: 'oldInstalment' };
  const newInstalmentMinor = toMinor(raw.newInstalmentMajor.trim());
  if (!newInstalmentMinor) return { ok: false, error: 'newInstalment' };

  const oldTenorMonths = intIn(raw.oldTenorMonths, 1, 600);
  if (oldTenorMonths === null) return { ok: false, error: 'oldTenor' };
  const newTenorMonths = intIn(raw.newTenorMonths, 1, 600);
  if (newTenorMonths === null) return { ok: false, error: 'newTenor' };

  const rateAprBps = intIn(raw.rateAprBps, 0, 10000);
  if (rateAprBps === null) return { ok: false, error: 'rate' };
  if (rateAprBps !== raw.currentRateAprBps) return { ok: false, error: 'rateChanged' };


  const totalInterestDeltaMinor = toMinor(raw.totalInterestDeltaMajor.trim());
  if (!totalInterestDeltaMinor) return { ok: false, error: 'interestDelta' };

  const value: RestructureInput = {
    reasonCode: raw.reasonCode as 'weather_distress' | 'other',
    oldInstalmentMinor, newInstalmentMinor, oldTenorMonths, newTenorMonths, rateAprBps, totalInterestDeltaMinor,
  };

  let holidayMonths = 0;
  const holidayRaw = raw.holidayMonths.trim();
  if (holidayRaw) {
    const n = intIn(holidayRaw, 0, 24);
    if (n === null) return { ok: false, error: 'holidayMonths' };
    holidayMonths = n;
    value.holidayMonths = n;
  }
  const holidayStartsOn = raw.holidayStartsOn.trim();
  if (holidayStartsOn) {
    if (!DATE.test(holidayStartsOn)) return { ok: false, error: 'holidayStartsOn' };
    if (holidayMonths === 0) return { ok: false, error: 'holidayMonths' };   // a start date with no holiday is a mistake
    value.holidayStartsOn = holidayStartsOn;
  }
  const caseRef = raw.caseRef.trim();
  if (caseRef) {
    if (caseRef.length > 60) return { ok: false, error: 'caseRef' };
    value.caseRef = caseRef;
  }
  if (raw.penalInterestWaived) value.penalInterestWaived = true;

  // Must relieve SOMETHING (see the doctrine note above).
  const lighterInstalment = BigInt(newInstalmentMinor) < BigInt(oldInstalmentMinor);
  const longerTenor = newTenorMonths > oldTenorMonths;
  if (!lighterInstalment && !longerTenor && holidayMonths === 0) return { ok: false, error: 'noRelief' };

  return { ok: true, value };
}

function intIn(s: string, lo: number, hi: number): number | null {
  const t = s.trim();
  if (!/^\d{1,6}$/.test(t)) return null;   // digits only — a fractional tenor or bps is refused, never truncated
  const n = Number.parseInt(t, 10);
  return n >= lo && n <= hi ? n : null;
}

// ---------------------------------------------------------------------------
// Write-off
// ---------------------------------------------------------------------------
/** Only an OVERDUE loan can be written off (server guard). An active loan showing a write-off button would invite
 *  somebody to end a paying borrower's account. */
export function canWriteOff(loanStatus: string | null | undefined): boolean { return loanStatus === 'overdue'; }

export type WriteOffResult = { ok: true; value: { reason: string } } | { ok: false; error: 'reason' | 'status' };

export function buildWriteOff(raw: { reason: string }, loanStatus: string | null | undefined): WriteOffResult {
  if (!canWriteOff(loanStatus)) return { ok: false, error: 'status' };
  const reason = raw.reason.trim();
  if (reason.length < 3 || reason.length > 500) return { ok: false, error: 'reason' };
  return { ok: true, value: { reason } };
}
