// apps/web-admin/src/features/payouts/payouts.ts · W062/W063/W066/W067/W442 view logic, PURE (PC-56 ADMIN-6b).
//
// Every function here is a pure mapping from a server field to a class name or an i18n KEY. No text lives in this file:
// web-admin is EN-only today and will not always be, and a string returned from a formatter is a string no translator
// will ever find.
//
// MONEY IS FORMATTED FROM A STRING, VIA BIGINT, AND NEVER VIA `Number`. Every money field crosses the wire as a decimal
// string of minor units; a settlement cycle aggregate for 15,000 tenants passes 2^53 long before this platform reaches
// the GMV it is aiming at, and a float that has lost its last digit still looks exactly like money on a screen.

/* ------------------------------------------------------------------------------------------------ */
/* MONEY                                                                                             */
/* ------------------------------------------------------------------------------------------------ */

export function formatMinor(minor: string | null | undefined, currency = 'INR'): string {
  if (minor === null || minor === undefined || minor === '') return '—';
  let v: bigint;
  // An unparseable money string renders as an em dash rather than as 0. "₹0.00 awaiting approval" and "we could not
  // read this figure" are opposite statements, and on the money door the second must never be shown as the first.
  try { v = BigInt(minor); } catch { return '—'; }
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const sym = currency === 'INR' ? '₹' : '';
  return `${neg ? '−' : ''}${sym}${(abs / 100n).toLocaleString('en-IN')}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** Σ a column of money strings. Returns null when ANY entry is unreadable rather than skipping it.
 *
 *  Skipping would produce a total over a subset and present it as the total — which on a batch-approval screen is the
 *  single most dangerous readout in this console, because it is the number a human signs. Same rule as ADMIN-5e's leg
 *  summation, where a mutation test taught the harder half of this lesson: a cancelling pair sums to 0, and 0 survives
 *  any lossy conversion, so the test's EXPECTED value has to be one a broken implementation could not also produce.
 */
export function sumMinor(values: readonly (string | null | undefined)[]): string | null {
  let total = 0n;
  for (const v of values) {
    if (v === null || v === undefined || v === '') return null;
    try { total += BigInt(v); } catch { return null; }
  }
  return total.toString();
}

/* ------------------------------------------------------------------------------------------------ */
/* W066 · THE BATCH LIST                                                                             */
/* ------------------------------------------------------------------------------------------------ */

export type Phase = 'awaiting_checker' | 'approved' | 'returned' | 'executing' | 'executed' | 'failed' | 'unknown';

/** The badge class. `awaiting_checker` is a WARNING and not a neutral note, deliberately: on this screen a batch nobody
 *  has signed is money sitting still, and farmers are waiting for it. Grey would make the queue restful. */
export function phaseClass(p: Phase): string {
  switch (p) {
    case 'awaiting_checker': return 'kv-badge is-warn';
    case 'approved': return 'kv-badge is-info';
    case 'executing': return 'kv-badge is-info';
    case 'executed': return 'kv-badge is-ok';
    case 'returned': return 'kv-badge';
    case 'failed': return 'kv-badge is-danger';
    default: return 'kv-badge';
  }
}

export function phaseKey(p: Phase): string { return `po.phase.${p}`; }

/** W066's "Executed" column: "11:20 · 96/96 success" or "18:40 · 1,839/1,842 · 3 failed".
 *
 *  A batch that has NOT executed returns null so the cell renders the dash the table already uses for absent values —
 *  not "0/0", which reads as a run that found nothing rather than a run that has not happened. */
export function executionSummary(b: {
  phase: Phase; count: number; executedAt: string | null; shortfall?: boolean;
}): { at: string; ok: number; total: number; failed: number } | null {
  if (b.phase !== 'executed' && b.phase !== 'failed') return null;
  if (!b.executedAt) return null;
  // The platform records the SETTLED TOTAL and the count, not a per-payout success tally on the batch, so a shortfall is
  // the only signal that some payouts failed and the exact number is not derivable from the batch row. The cell says
  // "some failed" rather than inventing a count — see `shortfallKey`.
  return { at: b.executedAt, ok: b.shortfall ? -1 : b.count, total: b.count, failed: b.shortfall ? -1 : 0 };
}

/** Whether the batch settled less than it was approved for, as an i18n key. `-1` above means "unknown how many", and
 *  this is the honest sentence for it. */
export function shortfallKey(shortfall: boolean): string | null {
  return shortfall ? 'po.batch.shortfall' : null;
}

/* ------------------------------------------------------------------------------------------------ */
/* W067 · THE APPROVE CONTROL                                                                        */
/* ------------------------------------------------------------------------------------------------ */

export type ApprovalKind = 'approvable' | 'needs_other_operator' | 'already' | 'empty' | 'blocked' | 'no_preflight';

/** MAKER-CHECKER BY ABSENCE. The control is NOT DRAWN unless the answer is `approvable`.
 *
 *  A disabled Approve button teaches an operator that they nearly have the right to authorise their own disbursement; an
 *  absent one beside a line naming the rule teaches them to find a colleague. That is the standing doctrine on this
 *  platform and this is the highest-stakes place it applies.
 */
export function showApprove(kind: ApprovalKind): boolean { return kind === 'approvable'; }

/** The Return control is shown in every state a return is legal from — which is `open` only, so every non-approvable
 *  kind EXCEPT `already`. Notably it IS shown to the maker: refusing your own batch is noticing your own mistake, and
 *  making the safe action the expensive one is how a bad run gets approved at 02:00 because stopping it needed a
 *  colleague. */
export function showReturn(kind: ApprovalKind): boolean { return kind !== 'already'; }

export function approvalNoticeKey(kind: ApprovalKind): string { return `po.approval.${kind}`; }

/** The class for the notice beside a withheld control. `blocked` and `no_preflight` are DANGER rather than warnings:
 *  each means the batch cannot be trusted as displayed, and the difference between them matters — one is a known problem
 *  and the other is not knowing, which is worse. */
export function approvalNoticeClass(kind: ApprovalKind): string {
  switch (kind) {
    case 'blocked': return 'kv-note is-danger';
    case 'no_preflight': return 'kv-note is-danger';
    case 'needs_other_operator': return 'kv-note is-warn';
    case 'empty': return 'kv-note is-warn';
    default: return 'kv-note';
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* THE PREFLIGHT PANEL                                                                               */
/* ------------------------------------------------------------------------------------------------ */

export type PreflightFailure =
  | 'no_payee' | 'kyc_not_verified' | 'kyc_unknown' | 'bank_unverified'
  | 'wallet_frozen' | 'not_payable' | 'zero_or_negative';

export function failureKey(f: string): string {
  // An unrecognised failure code from a newer server renders as a generic line rather than as the raw code. Showing
  // `zero_or_negative` to an operator is showing them our variable names; showing nothing would hide a blocked payout.
  const known: readonly string[] = [
    'no_payee', 'kyc_not_verified', 'kyc_unknown', 'bank_unverified', 'wallet_frozen', 'not_payable', 'zero_or_negative',
  ];
  return known.includes(f) ? `po.pf.${f}` : 'po.pf.other';
}

/** The panel's headline verdict. `null` preflight is NOT a pass and not a fail — it is "not run", which is its own state
 *  and the one W067's PASS badge silently occupied before this wave. */
export type PreflightVerdict = 'pass' | 'blocked' | 'not_run' | 'over_limit';

export function preflightVerdict(
  pf: { pass: boolean; checked: number; blocked: number } | null,
  overLimit: { limit: number } | null,
): PreflightVerdict {
  if (overLimit) return 'over_limit';
  if (!pf) return 'not_run';
  return pf.pass ? 'pass' : 'blocked';
}

export function preflightClass(v: PreflightVerdict): string {
  switch (v) {
    case 'pass': return 'kv-badge is-ok';
    case 'blocked': return 'kv-badge is-danger';
    // NOT RUN AND OVER LIMIT ARE BOTH DANGER, not neutral. Each one means the screen cannot vouch for the set below it,
    // and a grey badge over 214 unchecked payouts is exactly the reassurance this wave exists to withdraw.
    default: return 'kv-badge is-danger';
  }
}

export function preflightKey(v: PreflightVerdict): string { return `po.pf.verdict.${v}`; }

/** "₹4,82,120 of ₹4,82,120 payable" — and when they differ, that difference is the finding. Returns whether to show the
 *  second figure at all, because two identical numbers side by side invite a reader to look for a difference. */
export function payableDiffers(payableMinor: string, totalMinor: string): boolean {
  return payableMinor !== totalMinor;
}

/** Did the world change since the checker signed? */
export function driftKey(d: { drifted: boolean; reason?: string } | null): string | null {
  if (!d || !d.drifted) return null;
  switch (d.reason) {
    case 'payable_changed': return 'po.drift.payable';
    case 'blocked_changed': return 'po.drift.blocked';
    case 'no_record': return 'po.drift.noRecord';
    default: return 'po.drift.other';
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* PAYOUT LINE ROWS                                                                                  */
/* ------------------------------------------------------------------------------------------------ */

/** W067's priority column. The wage lane is 10 and the default is 100 — lower is more urgent, which is the opposite of
 *  how most people read a "priority" number, so the label says which lane rather than showing the integer alone. */
export function laneKey(priority: number): string {
  if (!Number.isFinite(priority)) return 'po.lane.unknown';
  if (priority <= 10) return 'po.lane.wage';
  if (priority < 100) return 'po.lane.expedited';
  return 'po.lane.settlement';
}

export function payoutStatusClass(s: string): string {
  switch (s) {
    case 'success': return 'kv-badge is-ok';
    case 'queued': return 'kv-badge';
    case 'processing': return 'kv-badge is-info';
    case 'failed': return 'kv-badge is-danger';
    case 'reversed': return 'kv-badge is-warn';
    case 'cancelled': return 'kv-badge';
    default: return 'kv-badge';
  }
}

/** The bank cell: "XXXX-4417 · SBI" in the canon. We have the last four and an IFSC, and the IFSC's first four
 *  characters are the bank code — but resolving that to a bank NAME needs a table this platform does not have, so the
 *  cell shows the code rather than a guessed name. A wrong bank name beside somebody's account number is worse than a
 *  code the operator can look up. */
export function bankCell(last4: string | null, ifsc: string | null): string {
  const acct = last4 ? `XXXX-${last4}` : '—';
  return ifsc ? `${acct} · ${ifsc}` : acct;
}

/* ------------------------------------------------------------------------------------------------ */
/* W062 · THE SETTLEMENT BOARD                                                                       */
/* ------------------------------------------------------------------------------------------------ */

export type Tile = { known: true; minor: string; note: string | null } | { known: false; reason: string };

/** A tile renders its figure OR its reason, never a zero standing in for a reason. */
export function tileText(t: Tile): { value: string; unknownKey: string | null } {
  if (t.known) return { value: formatMinor(t.minor), unknownKey: null };
  return { value: '—', unknownKey: t.reason === 'no_run_today' ? 'po.tile.noRun' : 'po.tile.notRecorded' };
}

export type RunOutcomeKind = 'running' | 'clean' | 'partial' | 'failed' | 'abandoned' | 'unknown';

export function outcomeClass(k: RunOutcomeKind): string {
  switch (k) {
    case 'clean': return 'kv-badge is-ok';
    case 'running': return 'kv-badge is-info';
    case 'partial': return 'kv-badge is-warn';
    // ABANDONED IS AS SERIOUS AS FAILED and is drawn the same. A cycle that stopped without saying so is worse than one
    // that reported a failure: nobody was told, and the statements the next day's payouts are built from are missing.
    case 'failed': return 'kv-badge is-danger';
    case 'abandoned': return 'kv-badge is-danger';
    default: return 'kv-badge';
  }
}

export function outcomeKey(k: RunOutcomeKind): string { return `po.run.${k}`; }

/** Which basis the totals were computed on. Shown, not hidden: a total that silently switches its own definition
 *  between "this run's aggregates" and "everything filed for this period" is worse than one that says which it is. */
export function basisKey(basis: string): string | null {
  return basis === 'period' ? 'po.basis.period' : basis === 'none' ? 'po.basis.none' : null;
}

/* ------------------------------------------------------------------------------------------------ */
/* W063 + W442 · THE STATEMENT                                                                       */
/* ------------------------------------------------------------------------------------------------ */

export type PdfKind = 'not_generated' | 'never_hashed' | 'anchored' | 'mismatch';

export function pdfClass(k: PdfKind): string {
  switch (k) {
    case 'anchored': return 'kv-badge is-ok';
    case 'mismatch': return 'kv-badge is-danger';
    // NEVER HASHED IS A WARNING, NOT AN OK. W442 calls the PDF "hash-anchored to the zero-sum ledger" and until 0114
    // there was no column to anchor it in, so this is the state almost every existing statement is in — and the screen
    // says so rather than printing "signed" over nothing, which is what it did before.
    case 'never_hashed': return 'kv-badge is-warn';
    default: return 'kv-badge';
  }
}

export function pdfKey(k: PdfKind): string { return `po.pdf.${k}`; }

/** Short form of a digest for a table cell. 8 + 8 with an ellipsis, matching W442's "88ac…17fe" and the ledger
 *  explorer's hash cells, so the two screens are read the same way. */
export function shortHash(h: string | null | undefined): string {
  if (!h) return '—';
  // A hash too short to abbreviate is shown whole rather than mangled. It is also a signal: a 64-hex digest is what the
  // CHECK constrains, so anything shorter arrived from somewhere that did not compute one.
  return h.length <= 20 ? h : `${h.slice(0, 8)}…${h.slice(-8)}`;
}

/** The statement's own arithmetic. FALSE means the document contradicts itself, which W442's whole claim ("the
 *  arithmetic below is the ledger's, to the rupee") rests on not happening. */
export function balanceClass(balanced: boolean): string {
  return balanced ? 'kv-badge is-ok' : 'kv-badge is-danger';
}

export function balanceKey(balanced: boolean): string {
  return balanced ? 'po.stmt.balanced' : 'po.stmt.unbalanced';
}

/** Do the per-order lines add up to the statement's own totals? A separate question from the statement's internal
 *  arithmetic, and reported separately — a single flag covering both would tell an investigator nothing about where to
 *  look. */
export function lineAgreementKey(agrees: boolean, count: number): string | null {
  if (count === 0) return 'po.stmt.noLines';
  return agrees ? null : 'po.stmt.linesDisagree';
}

/* ------------------------------------------------------------------------------------------------ */
/* CYCLE DATES                                                                                       */
/* ------------------------------------------------------------------------------------------------ */

/** Is this a date the console can send as a cycle? Mirrors the server's rule so the operator is told in the form rather
 *  than by a 400 — and the server still checks, because a client-side rule is a courtesy and not a constraint. */
export function isCycleDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** A cycle cannot be requested for a period that has not finished. The settlement job aggregates un-statemented lines in
 *  a window, so asking for tomorrow would open a run over a period in which orders are still being delivered — and its
 *  `completed` row would then block the real cycle, because `uq_settlement_run_completed_period` allows one. */
export function cycleInFuture(periodEnd: string, todayIso: string): boolean {
  return periodEnd > todayIso;
}
