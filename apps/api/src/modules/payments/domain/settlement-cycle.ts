// modules/payments/domain/settlement-cycle.ts · W147/W148's rules as PURE functions (PC-56 TENANT-4c).
// The cycle that did not exist, the close that is an act by two people, and the honest arithmetic of
// "186 statements" — no I/O, no Nest, no SQL.
import { DomainError } from '../../../shared/errors/app-error';

export class SettlementCycleError extends DomainError {}

export const CYCLE_STATUSES = ['open', 'pending_close', 'closing', 'closed', 'rejected'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

/** Note what is ABSENT: `open` cannot reach `closing`. Generation happens only after a second person has
 *  approved, so no code path — including one written by somebody who has not read W147 — can produce a
 *  cycle's statements without the close having been signed. */
const TRANSITIONS: Readonly<Record<CycleStatus, readonly CycleStatus[]>> = Object.freeze({
  open: ['pending_close'],
  pending_close: ['closing', 'rejected'],
  closing: ['closed'],
  closed: [],
  rejected: ['open'],          // a rejected close returns the cycle to open; the period is still live
});

export function canTransition(from: CycleStatus, to: CycleStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
export function assertTransition(from: CycleStatus, to: CycleStatus): void {
  if (!canTransition(from, to)) {
    throw new SettlementCycleError('SETTLEMENT_CYCLE_ILLEGAL_TRANSITION', `Cannot move a settlement cycle ${from} → ${to}`, 409, { from, to });
  }
}

/* ------------------------------------------------------------------------------------------------
 * THE PERIOD (a SETTING, not a hardcoded fortnight)
 * ---------------------------------------------------------------------------------------------- */

export const CYCLE_LENGTHS = ['fortnightly', 'monthly'] as const;
export type CycleLength = (typeof CYCLE_LENGTHS)[number];
export const DEFAULT_CYCLE_LENGTH: CycleLength = 'fortnightly';

export function isCycleLength(v: unknown): v is CycleLength {
  return typeof v === 'string' && (CYCLE_LENGTHS as readonly string[]).includes(v);
}

export interface CyclePeriod { startIso: string; endIso: string }

/** The period containing `on`, for the tenant's configured length. Dates only (a cycle is a set of days,
 *  not an instant), computed in UTC and rendered in the reader's locale — a wall-clock cycle boundary in
 *  the backend would be a hidden timezone assumption, and this platform ships to five countries by Y7. */
export function periodFor(on: Date, length: CycleLength): CyclePeriod {
  const y = on.getUTCFullYear();
  const m = on.getUTCMonth();
  const d = on.getUTCDate();
  const iso = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd)).toISOString().slice(0, 10);
  const lastOfMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  if (length === 'monthly') return { startIso: iso(y, m, 1), endIso: iso(y, m, lastOfMonth) };
  return d <= 15
    ? { startIso: iso(y, m, 1), endIso: iso(y, m, 15) }
    : { startIso: iso(y, m, 16), endIso: iso(y, m, lastOfMonth) };
}

/** The period after this one — what a close opens next, so a tenant is never left without a live cycle. */
export function nextPeriod(period: CyclePeriod, length: CycleLength): CyclePeriod {
  const end = new Date(`${period.endIso}T00:00:00Z`);
  return periodFor(new Date(end.getTime() + 86_400_000), length);
}

/** Has the cycle's last day finished? A cycle closed mid-period would leave orders that completed on the
 *  15th out of the fortnight they belong to, and the seller would never learn which statement they landed
 *  in. `now` is compared against the END of the last day, in UTC. */
export function periodHasEnded(period: CyclePeriod, now: Date): boolean {
  const endExclusive = new Date(`${period.endIso}T00:00:00Z`).getTime() + 86_400_000;
  return now.getTime() >= endExclusive;
}

/** The statement-number period the series belongs to (`next_doc_number`'s 4th argument). Derived from the
 *  cycle START, so both halves of a fortnightly month share one series and its numbering stays continuous
 *  within the month a reader would look under. */
export function seriesPeriod(period: CyclePeriod): string {
  return period.startIso.slice(0, 7);
}

/* ------------------------------------------------------------------------------------------------
 * THE CLOSE
 * ---------------------------------------------------------------------------------------------- */

export const NOTE_FLOOR = 20;

export interface CycleForDecision {
  id: string;
  status: CycleStatus;
  periodStart: string;
  periodEnd: string;
  requestedBy: string | null;
  sellersExpected: number | null;
  statementsGenerated: number;
}

export type CloseRefusal =
  | 'SETTLEMENT_CYCLE_NOT_OPEN'
  | 'SETTLEMENT_CYCLE_PERIOD_NOT_ENDED'
  | 'SETTLEMENT_CYCLE_NOTHING_TO_SETTLE'
  | 'SETTLEMENT_CYCLE_NOT_PENDING'
  | 'SETTLEMENT_CYCLE_CHECKER_IS_REQUESTER'
  | 'SETTLEMENT_CYCLE_NOTE_TOO_SHORT';

/** Requesting a close. The period must have ENDED and there must be something to settle — a cycle closed
 *  over zero sellers produces zero statements and a status that says a cycle was settled when nothing was. */
export function requestRefusal(c: CycleForDecision, sellersWithOpenLines: number, now: Date): CloseRefusal | null {
  if (c.status !== 'open') return 'SETTLEMENT_CYCLE_NOT_OPEN';
  if (!periodHasEnded({ startIso: c.periodStart, endIso: c.periodEnd }, now)) return 'SETTLEMENT_CYCLE_PERIOD_NOT_ENDED';
  if (sellersWithOpenLines <= 0) return 'SETTLEMENT_CYCLE_NOTHING_TO_SETTLE';
  return null;
}

/** Approving a close: a DIFFERENT person, unconditionally. W147 states no threshold here, and a cycle close
 *  is not an amount — it is a decision that turns a fortnight of trade into documents a member will hold
 *  and a bank manager will read. Every one of them gets two humans. */
export function approveRefusal(c: CycleForDecision, actorUserId: string): CloseRefusal | null {
  if (c.status !== 'pending_close') return 'SETTLEMENT_CYCLE_NOT_PENDING';
  if (c.requestedBy && c.requestedBy === actorUserId) return 'SETTLEMENT_CYCLE_CHECKER_IS_REQUESTER';
  return null;
}

/** Rejecting one: the reason is required, at the same floor as every other note in this programme. Note
 *  that a rejection does NOT require a different person — refusing your own request is always allowed, and
 *  a control that forced a second human to undo a mistake would just delay the fix. */
export function rejectRefusal(c: CycleForDecision, note: string): CloseRefusal | null {
  if (c.status !== 'pending_close') return 'SETTLEMENT_CYCLE_NOT_PENDING';
  if ((note ?? '').trim().length < NOTE_FLOOR) return 'SETTLEMENT_CYCLE_NOTE_TOO_SHORT';
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * PROGRESS — the honest replacement for "atomically"
 * ---------------------------------------------------------------------------------------------- */

export type ProgressState =
  | { kind: 'not_started' }
  /** Generation is under way: this many of that many. The number an operator can act on. */
  | { kind: 'generating'; generated: number; expected: number; remaining: number }
  | { kind: 'complete'; generated: number }
  /** More statements exist than the cycle expected. Not silently rounded down: it means a seller gained
   *  lines after the close was approved, and somebody needs to know which. */
  | { kind: 'over_generated'; generated: number; expected: number };

export function progressOf(c: { status: CycleStatus; sellersExpected: number | null; statementsGenerated: number }): ProgressState {
  if (c.sellersExpected === null) return { kind: 'not_started' };
  if (c.statementsGenerated > c.sellersExpected) return { kind: 'over_generated', generated: c.statementsGenerated, expected: c.sellersExpected };
  if (c.statementsGenerated >= c.sellersExpected) return { kind: 'complete', generated: c.statementsGenerated };
  return { kind: 'generating', generated: c.statementsGenerated, expected: c.sellersExpected, remaining: c.sellersExpected - c.statementsGenerated };
}

/** May the cycle move to `closed`? Only when the work is done — the status must never outrun the documents,
 *  which is what 0144's `ck_settlement_cycle_closed_complete` repeats in the schema. */
export function isCompletable(c: { status: CycleStatus; sellersExpected: number | null; statementsGenerated: number }): boolean {
  const p = progressOf(c);
  return c.status === 'closing' && (p.kind === 'complete' || p.kind === 'over_generated');
}

/* ------------------------------------------------------------------------------------------------
 * W147's COMMISSION COLUMN, and why it reads zero
 * ---------------------------------------------------------------------------------------------- */

export type DeductionBasis = 'charged_to_buyer' | 'charged_to_seller' | 'no_rule_resolved';

/** W147: "Commission and tax columns show ₹0 because Anand FPO charges buyers, not sellers
 *  (commission_rules.charged_to = buyer). A seller-side tenant would see real deductions here — the columns
 *  exist because the schema does." A zero with a BASIS, which is the difference between "nothing was
 *  deducted" and "we did not resolve a rule". */
export function deductionBasis(chargedTo: string | null | undefined): DeductionBasis {
  if (chargedTo === 'buyer') return 'charged_to_buyer';
  if (chargedTo === 'seller') return 'charged_to_seller';
  return 'no_rule_resolved';
}

/** gross − commission − tax = net, checked rather than trusted. A row where it does not hold is not
 *  displayed as arithmetic that works; the console flags it, because a seller's net is what they are paid. */
export function netReconciles(row: { grossMinor: string; commissionMinor: string; taxMinor: string; netMinor: string }): boolean {
  return BigInt(row.grossMinor) - BigInt(row.commissionMinor) - BigInt(row.taxMinor) === BigInt(row.netMinor);
}

/* ------------------------------------------------------------------------------------------------
 * W148: the statement's own period, and what a pre-wave statement actually is
 * ---------------------------------------------------------------------------------------------- */

export type StatementPeriodKind = 'cycle' | 'legacy_daily';

/** Before this wave, statements were generated by a nightly previous-day job, so their period is ONE DAY.
 *  W148 presents fortnightly documents; the console must not relabel a daily statement as a cycle one.
 *  A statement carrying a `cycleId` is a cycle statement; one without it is named for what it is. */
export function statementPeriodKind(row: { cycleId: string | null; periodStart: string; periodEnd: string }): StatementPeriodKind {
  if (row.cycleId) return 'cycle';
  return 'legacy_daily';
}

export function statementDayCount(row: { periodStart: string; periodEnd: string }): number {
  const a = Date.parse(`${row.periodStart}T00:00:00Z`);
  const b = Date.parse(`${row.periodEnd}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

/* ------------------------------------------------------------------------------------------------
 * W148's ORGANISATION MONTHLY STATEMENT
 * ---------------------------------------------------------------------------------------------- */

/** W148: "your organisation's monthly wallet statement. What the bank manager and the auditor both
 *  accept." NOTHING stored one. Rather than adding a table of copies, this is DERIVED from the tenant's own
 *  append-only ledger every time it is asked for — opening balance, movements by type, closing balance —
 *  with an export receipt over the data. A derived document that reproduces from the book of record is
 *  strictly stronger than a stored PDF the book could later contradict, and it is the same reasoning that
 *  kept TENANT-3b from storing a frozen amount. What it is NOT is a numbered artefact, and the screen says
 *  so rather than implying a series that does not exist. */
export interface OrgStatementLine { txnType: string; creditMinor: string; debitMinor: string; count: number }

export interface OrgStatementView {
  period: string;                 // 'YYYY-MM'
  openingMinor: string;
  closingMinor: string;
  lines: OrgStatementLine[];
  /** opening + Σcredits − Σdebits must equal closing, or the statement is not issued at all. */
  reconciles: boolean;
  basis: 'derived_from_ledger';
}

export function isMonthPeriod(v: string | undefined | null): boolean {
  return !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** A month is exportable once it has ENDED. A statement of a month still in progress changes after it is
 *  handed to a bank manager, and 3c-1's GSTR-1 export refuses an open period for the same reason. */
export function isClosedMonth(period: string, now: Date): boolean {
  if (!isMonthPeriod(period)) return false;
  const [y, m] = period.split('-').map(Number);
  return now.getTime() >= Date.UTC(y, m, 1);
}

export function buildOrgStatement(input: {
  period: string; openingMinor: string; closingMinor: string; lines: OrgStatementLine[];
}): OrgStatementView {
  const credits = input.lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
  const debits = input.lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
  const reconciles = BigInt(input.openingMinor) + credits - debits === BigInt(input.closingMinor);
  return { ...input, reconciles, basis: 'derived_from_ledger' };
}

/** Assemble-or-refuse: a statement whose own arithmetic does not close is not a document, it is a bug with
 *  a letterhead. The caller refuses by name rather than printing it with a warning. */
export function assertOrgStatement(v: OrgStatementView): OrgStatementView {
  if (!v.reconciles) {
    throw new SettlementCycleError('ORG_STATEMENT_DOES_NOT_RECONCILE', 'opening + credits − debits ≠ closing; the statement was not issued', 500, { period: v.period });
  }
  return v;
}
