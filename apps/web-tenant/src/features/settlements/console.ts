// apps/web-tenant/src/features/settlements/console.ts · W147's cycle and W148's statements as PURE rules
// (PC-56 TENANT-4c). No React, no I/O — unit- and mutation-tested, and the API re-enforces every one.

export const CYCLE_STATUSES = ['open', 'pending_close', 'closing', 'closed', 'rejected'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

export function cycleStatusKey(status: string): string {
  return `stl.status.${(CYCLE_STATUSES as readonly string[]).includes(status) ? status : 'unknown'}`;
}

/** W147's cycle card. The period is a set of DAYS and is rendered in the reader's own locale — the backend
 *  stores dates, never a wall-clock boundary, because a fortnight boundary in one timezone is a different
 *  fortnight in another and this platform ships to five countries by Y7. */
export function periodLabel(startIso: string, endIso: string): string {
  return `${startIso} → ${endIso}`;
}

export function hasPeriodEnded(endIso: string, now: Date): boolean {
  const endExclusive = Date.parse(`${endIso}T00:00:00Z`) + 86_400_000;
  return Number.isFinite(endExclusive) && now.getTime() >= endExclusive;
}

/* ------------------------------------------------------------------------------------------------
 * PROGRESS — the honest replacement for W147's "atomically"
 * ---------------------------------------------------------------------------------------------- */

export type Progress =
  | { kind: 'not_started' }
  | { kind: 'generating'; generated: number; expected: number; remaining: number }
  | { kind: 'complete'; generated: number }
  | { kind: 'over_generated'; generated: number; expected: number };

/** The sentence beside the count. `over_generated` is its own case: more statements than the close expected
 *  means a seller gained lines after the signature, and somebody needs to know rather than see it rounded. */
export function progressKey(p: Progress): string {
  return `stl.progress.${p.kind === 'not_started' ? 'notStarted' : p.kind === 'over_generated' ? 'overGenerated' : p.kind}`;
}

/** Is another generation pass worth offering? Only while a cycle is generating and work remains — a button
 *  that would do nothing is a button that teaches an operator to ignore buttons. */
export function canGenerate(status: string, p: Progress): boolean {
  return status === 'closing' && (p.kind === 'generating' || p.kind === 'not_started');
}

/* ------------------------------------------------------------------------------------------------
 * THE CLOSE
 * ---------------------------------------------------------------------------------------------- */

export const NOTE_FLOOR = 20;
export function isNoteLongEnough(note: string | undefined | null): boolean {
  return (note ?? '').trim().length >= NOTE_FLOOR;
}

export type CloseBlock = 'noPermission' | 'notOpen' | 'periodNotEnded' | 'nothingToSettle';

/** What stands between this cycle and a close request. Same ORDER as the API's refusals, so the screen's
 *  reason and the server's reason can never disagree. */
export function requestBlockedBy(
  v: { status: string; periodEnd: string; sellerCount: number },
  perms: { canClose: boolean },
  now: Date,
): CloseBlock | null {
  if (!perms.canClose) return 'noPermission';
  if (v.status !== 'open') return 'notOpen';
  if (!hasPeriodEnded(v.periodEnd, now)) return 'periodNotEnded';
  if (v.sellerCount <= 0) return 'nothingToSettle';
  return null;
}

export type DecisionBlock = 'noPermission' | 'notPending' | 'youRequested';

/** Approving needs a DIFFERENT person — unconditionally, because a cycle close is not an amount. Rejecting
 *  does NOT: refusing your own request is always allowed, and forcing a second human to undo a mistake would
 *  only delay the fix. */
export function approveBlockedBy(
  v: { status: string; requestedBy: string | null },
  viewerUserId: string | null,
  perms: { canClose: boolean },
): DecisionBlock | null {
  if (!perms.canClose) return 'noPermission';
  if (v.status !== 'pending_close') return 'notPending';
  if (v.requestedBy && viewerUserId && v.requestedBy === viewerUserId) return 'youRequested';
  return null;
}

export function rejectBlockedBy(
  v: { status: string },
  perms: { canClose: boolean },
): 'noPermission' | 'notPending' | null {
  if (!perms.canClose) return 'noPermission';
  if (v.status !== 'pending_close') return 'notPending';
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * W147's DEDUCTION COLUMNS
 * ---------------------------------------------------------------------------------------------- */

/** Why commission and tax read what they read. `no_rule_resolved` is NOT presented as "charged to buyer":
 *  a zero because nobody configured a rule and a zero because buyers pay are different facts, and only one
 *  of them means the seller keeps their full gross by design. */
export function deductionNoteKey(basis: string): string {
  if (basis === 'charged_to_buyer') return 'stl.deduction.buyer';
  if (basis === 'charged_to_seller') return 'stl.deduction.seller';
  return 'stl.deduction.noRule';
}

/** A seller row whose gross − commission − tax ≠ net is FLAGGED. The net is what the member is paid; a
 *  console that displayed it as working arithmetic would be the last place anybody could catch it. */
export function rowNeedsAttention(row: { reconciles: boolean }): boolean {
  return !row.reconciles;
}

/* ------------------------------------------------------------------------------------------------
 * W148's STATEMENTS
 * ---------------------------------------------------------------------------------------------- */

/** A statement issued before this wave came from the nightly previous-day job, so its period is ONE DAY.
 *  W148 presents fortnightly documents; relabelling a daily statement as a cycle one would be the console
 *  telling a member their fortnight is in a document that covers a Tuesday. */
export function periodKindKey(kind: string): 'stl.period.cycle' | 'stl.period.daily' {
  return kind === 'cycle' ? 'stl.period.cycle' : 'stl.period.daily';
}

export function pdfStateKey(hasPdf: boolean): 'stl.pdf.ready' | 'stl.pdf.notRendered' {
  return hasPdf ? 'stl.pdf.ready' : 'stl.pdf.notRendered';
}

/** W148's month picker for the org statement: only months that have ENDED, newest first. A statement of a
 *  month still running changes after a bank manager has read it. */
export function closedMonths(now: Date, count = 12): string[] {
  const out: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export function isMonthPeriod(v: string | undefined | null): boolean {
  return !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

export function isClosedMonth(period: string, now: Date): boolean {
  if (!isMonthPeriod(period)) return false;
  const [y, m] = period.split('-').map(Number);
  return now.getTime() >= Date.UTC(y, m, 1);
}

/** Every refusal the API can return here, translated BY NAME. */
export const REFUSALS: Record<string, string> = {
  SETTLEMENT_CYCLE_NOT_OPEN: 'notOpen',
  SETTLEMENT_CYCLE_PERIOD_NOT_ENDED: 'periodNotEnded',
  SETTLEMENT_CYCLE_NOTHING_TO_SETTLE: 'nothingToSettle',
  SETTLEMENT_CYCLE_NOT_PENDING: 'notPending',
  SETTLEMENT_CYCLE_CHECKER_IS_REQUESTER: 'checkerIsRequester',
  SETTLEMENT_CYCLE_NOTE_TOO_SHORT: 'noteShort',
  SETTLEMENT_CYCLE_NOT_CLOSING: 'notClosing',
  SETTLEMENT_CYCLE_NOT_FOUND: 'notFound',
  SETTLEMENT_CYCLE_ILLEGAL_TRANSITION: 'illegalTransition',
  ORG_STATEMENT_PERIOD_OPEN: 'monthOpen',
  ORG_STATEMENT_PERIOD_INVALID: 'monthInvalid',
  ORG_STATEMENT_DOES_NOT_RECONCILE: 'statementBroken',
};

export function refusalKey(code: string): string {
  return `stl.err.${REFUSALS[code] ?? 'generic'}`;
}
