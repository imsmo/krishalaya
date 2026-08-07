// apps/admin-api/src/modules/payout-ops/domain/settlement-cycle.ts · W062/W063/W442, PURE (PC-56 ADMIN-6b).
//
// ---------------------------------------------------------------------------
// THE DEFECT: THE CYCLE DOES THE WORK AND LEAVES NO RECORD OF HAVING DONE IT
// ---------------------------------------------------------------------------
// `SettlementStatementsJob.run(from, to)` scans every tenant for un-statemented `settlement_lines`, generates one
// statement per (tenant, seller), validates each against the zero-sum invariant, and returns
// `{ generated, skipped, failed }` — TO A LOG LINE. Nothing is persisted about the run.
//
// W062 is built entirely around that run: "Cycle: 13 Jul", "1,102 statements generated", "Run settlement cycle",
// "Cycle failed mid-run — Settlement is transactional per statement; completed ones stand, the rest retry", "No
// statements this cycle — the cycle runs at 18:00 IST daily; zero statements means no delivered orders today". Every
// one of those needs a cycle to have an identity, and it had none — so the numbers on that screen were the only part
// of it that could not be built, and the distinction between "no orders today" and "the cycle never ran" was
// unavailable to anybody.
//
// 0114 adds `settlement_runs`. This module is the reading of it.
//
// ---------------------------------------------------------------------------
// WHAT IS DELIBERATELY NOT HERE
// ---------------------------------------------------------------------------
// NO `settlement_statements.status`. A statement has no lifecycle: it is generated once from lines that are then linked
// so they can never be double-counted, and after that it is a document. The states W062's chips suggest ("pending /
// paid") belong to the PAYOUT the statement leads to, which is a different row in a different table with its own
// status. Adding a status column here would be a column recording transitions no code makes — the defect three of the
// last four waves were spent removing.
import { InvalidPayoutQueryError } from './payout-ops.errors';

export const RUN_STATUSES = ['running', 'completed', 'partial', 'failed'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export interface SettlementRunRow {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  sellersScanned: number;
  generatedCount: number;
  failedCount: number;
  grossMinor: bigint;
  commissionMinor: bigint;
  taxMinor: bigint;
  netMinor: bigint;
  finishedAt: string | null;
  triggeredByAdminId: string | null;
  failureDetail: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------------------------------------ */
/* W062's TOP TILES, AND THE ONE THAT MUST NOT BE COMPUTED                                           */
/* ------------------------------------------------------------------------------------------------ */

/** The four figures W062 prints: today's cycle, awaiting payout, commission earned, TDS withheld.
 *
 *  EACH TILE CARRIES ITS OWN KNOWN/UNKNOWN, and this is the `unknown ≠ zero` rule at its most consequential. "Today's
 *  cycle ₹0" and "no cycle has run today" render identically as a number, and they mean opposite things: the first is a
 *  quiet day and the second is a broken scheduler on the platform's money path. 0113 found exactly this on the recon
 *  board and the shape recurs here, so the type refuses to let a caller collapse them.
 */
export type Tile =
  | { known: true; minor: bigint; note?: string }
  | { known: false; reason: 'no_run_today' | 'not_recorded' };

export function cycleTile(run: SettlementRunRow | null): Tile {
  if (!run) return { known: false, reason: 'no_run_today' };
  return { known: true, minor: run.grossMinor, note: run.status };
}

/** Commission and TDS come from the run's own aggregates, so they are known exactly when the run is. */
export function componentTile(run: SettlementRunRow | null, pick: 'commission' | 'tax' | 'net'): Tile {
  if (!run) return { known: false, reason: 'no_run_today' };
  const minor = pick === 'commission' ? run.commissionMinor : pick === 'tax' ? run.taxMinor : run.netMinor;
  return { known: true, minor };
}

/** "Awaiting payout ₹4,82,120 · batch PB-0713-02 pending checker".
 *
 *  This one is NOT a settlement figure at all — it is the Σ of queued payouts sitting behind an unapproved batch, which
 *  is a number that only started existing when 0114 made a batch a gate. Before the gate there was nothing to await:
 *  payouts left on a timer. So the tile is honest about being empty on a platform where no batch has ever been opened,
 *  rather than showing ₹0 as though nothing were waiting.
 */
export function awaitingPayoutTile(v: { count: number; totalMinor: bigint } | null): Tile {
  if (!v) return { known: false, reason: 'not_recorded' };
  return { known: true, minor: v.totalMinor, note: `${v.count}` };
}

/* ------------------------------------------------------------------------------------------------ */
/* THE RUN'S OUTCOME, AS AN OPERATOR NEEDS IT                                                        */
/* ------------------------------------------------------------------------------------------------ */

export type RunOutcome =
  | { kind: 'running'; startedAt: string }
  | { kind: 'clean'; generated: number }
  /** W062's "Cycle failed mid-run" state. `partial` is its own status in 0114 rather than "completed with failures",
   *  because the screen's own copy is precise — completed statements stand and the rest retry — and folding it into
   *  `completed` would hide the one outcome that needs a second look. */
  | { kind: 'partial'; generated: number; failed: number }
  | { kind: 'failed'; failed: number; detail: string | null }
  /** A run row that has no `finished_at` and was created long ago. NOT a status in the database, because a crashed
   *  process cannot write its own epitaph — this is derived from the absence of an ending, which is the only signal a
   *  crash leaves. */
  | { kind: 'abandoned'; startedAt: string }
  | { kind: 'unknown' };

/** How long a run may stay `running` before its silence is itself the finding. The cadence is daily and a cycle over a
 *  day's lines is minutes of work, so six hours is generous by an order of magnitude — it is set long deliberately, so
 *  that `abandoned` means "certainly stuck" rather than "possibly slow", because the console draws it as an incident. */
export const RUN_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export function runOutcome(r: SettlementRunRow, nowMs: number): RunOutcome {
  if (r.status === 'running') {
    const startedMs = Date.parse(r.createdAt);
    // An unparseable timestamp is NOT read as fresh. A run whose start we cannot establish is exactly the case where
    // "probably fine" is the wrong guess, and `Number.isNaN` here rather than a comparison because NaN comparisons are
    // silently false in both directions — the bug that would make every stuck run look healthy.
    if (Number.isNaN(startedMs)) return { kind: 'unknown' };
    if (nowMs - startedMs > RUN_STALE_AFTER_MS) return { kind: 'abandoned', startedAt: r.createdAt };
    return { kind: 'running', startedAt: r.createdAt };
  }
  if (r.status === 'completed') return { kind: 'clean', generated: r.generatedCount };
  if (r.status === 'partial') return { kind: 'partial', generated: r.generatedCount, failed: r.failedCount };
  if (r.status === 'failed') return { kind: 'failed', failed: r.failedCount, detail: r.failureDetail };
  return { kind: 'unknown' };
}

/** The status a finishing run should be given, from what it actually did.
 *
 *  DERIVED FROM THE COUNTS RATHER THAN CHOSEN BY THE CALLER, so a run cannot report itself clean while carrying
 *  failures. That is the whole reason this is a function and not a parameter: the previous version of this logic was a
 *  log line, and a log line can say anything.
 *
 *  A run that scanned sellers and generated NOTHING while failing NOTHING is `completed` — that is W062's "zero
 *  statements means no delivered orders today", a real and ordinary outcome. A run where every seller failed is
 *  `failed`, not `partial`: nothing stands, so there is nothing to keep.
 */
export function statusFromCounts(c: { scanned: number; generated: number; failed: number }): RunStatus {
  if (c.failed === 0) return 'completed';
  if (c.generated === 0) return 'failed';
  return 'partial';
}

/* ------------------------------------------------------------------------------------------------ */
/* W063's ARITHMETIC, AND W442's ANCHOR                                                              */
/* ------------------------------------------------------------------------------------------------ */

export interface StatementRow {
  id: string;
  tenantId: string;
  sellerUserId: string;
  statementNo: string;
  periodStart: string;
  periodEnd: string;
  grossMinor: bigint;
  commissionMinor: bigint;
  taxMinor: bigint;
  netMinor: bigint;
  pdfMediaId: string | null;
  pdfSha256: string | null;
  pdfHashedAt: string | null;
  runId: string | null;
  createdAt: string;
}

export type StatementBalance =
  | { balanced: true; netMinor: bigint }
  /** The stored `net_minor` does not equal gross − commission − tax. W442's whole claim is "the arithmetic below is the
   *  ledger's, to the rupee", so this is not a rounding note — it is a corrupted financial document, and the screen must
   *  say so rather than print four numbers that do not add up and let the reader assume they do. */
  | { balanced: false; storedNetMinor: bigint; computedNetMinor: bigint; driftMinor: bigint };

/** RECOMPUTED ON EVERY READ, never trusted from the column.
 *
 *  `SettlementStatement.fromAggregate` in apps/api validates this at generation time and the job fails loud on a bad
 *  aggregate — which protects rows written through that path and says nothing about a row edited afterwards, or written
 *  by the earlier code, or restored from a backup. A document whose own arithmetic is the thing it asserts should have
 *  that arithmetic checked where it is displayed.
 */
export function statementBalance(s: Pick<StatementRow, 'grossMinor' | 'commissionMinor' | 'taxMinor' | 'netMinor'>): StatementBalance {
  const computed = s.grossMinor - s.commissionMinor - s.taxMinor;
  if (computed === s.netMinor) return { balanced: true, netMinor: s.netMinor };
  return { balanced: false, storedNetMinor: s.netMinor, computedNetMinor: computed, driftMinor: s.netMinor - computed };
}

/** W442 prints the sum as readable arithmetic: "₹1,03,228 − ₹1,048 = ₹1,02,180, to the rupee." Built from the parts in
 *  order so a reader can check it by eye, which is the point of showing it rather than a tick. */
export function statementEquation(s: Pick<StatementRow, 'grossMinor' | 'commissionMinor' | 'taxMinor' | 'netMinor'>): string {
  const parts = [`${s.grossMinor}`];
  if (s.commissionMinor !== 0n) parts.push(`− ${s.commissionMinor}`);
  if (s.taxMinor !== 0n) parts.push(`− ${s.taxMinor}`);
  return `${parts.join(' ')} = ${s.grossMinor - s.commissionMinor - s.taxMinor}`;
}

/** W442's PDF states: "signed" with a digest, "Not yet generated", and CHECKSUM MISMATCH — "File no longer matches the
 *  ledger hash — quarantined, alert raised; ledger remains the truth."
 *
 *  `never_hashed` IS THE HONEST DEFAULT AND IT WAS THE ONLY REAL STATE UNTIL 0114. `settlement_statements` had
 *  `pdf_media_id` and no hash column at all, so a checksum mismatch could not be represented, let alone detected, and
 *  the screen's "hash-anchored to the zero-sum ledger" was a sentence about a column that did not exist. Same shape as
 *  ADMIN-6's chain claim: the fix is not a better guess, it is an admission with a date once there is one.
 */
export type PdfState =
  | { kind: 'not_generated' }
  | { kind: 'never_hashed'; mediaId: string }
  | { kind: 'anchored'; mediaId: string; sha256: string; at: string }
  | { kind: 'mismatch'; mediaId: string; expected: string; actual: string };

export function pdfState(s: Pick<StatementRow, 'pdfMediaId' | 'pdfSha256' | 'pdfHashedAt'>, observedSha256?: string | null): PdfState {
  if (!s.pdfMediaId) return { kind: 'not_generated' };
  if (!s.pdfSha256 || !s.pdfHashedAt) return { kind: 'never_hashed', mediaId: s.pdfMediaId };
  // `observedSha256` is only supplied when something has actually re-read the file. Absent, the anchor is reported as
  // recorded rather than as verified — the ADMIN-6 rule that a claim carries the date somebody last checked it, and
  // never implies a check that did not happen.
  if (observedSha256 && observedSha256 !== s.pdfSha256) {
    return { kind: 'mismatch', mediaId: s.pdfMediaId, expected: s.pdfSha256, actual: observedSha256 };
  }
  return { kind: 'anchored', mediaId: s.pdfMediaId, sha256: s.pdfSha256, at: s.pdfHashedAt };
}

/* ------------------------------------------------------------------------------------------------ */
/* MONEY IN AND OUT OF THE CONSOLE                                                                   */
/* ------------------------------------------------------------------------------------------------ */

export function formatMinor(minor: bigint, currency = 'INR'): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const sym = currency === 'INR' ? '₹' : '';
  return `${neg ? '−' : ''}${sym}${(abs / 100n).toLocaleString('en-IN')}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** Parse a bigint that arrived from `pg` as a string. Refuses a JS number outright.
 *
 *  A settlement cycle for 15,000 tenants aggregates past 2^53 minor units (about ₹90,071,992,547) long before this
 *  platform reaches the GMV it is aiming at, and a float that has lost its last digit still looks exactly like money.
 *  The number branch has its own message because that branch's entire purpose IS the message — a mutation test in
 *  ADMIN-6 survived by deleting a branch just like this one, since a JS number is also not a string and the generic
 *  path threw anyway. Asserting only the error type proved nothing about it.
 */
export function parseMinor(v: unknown, field = 'amount'): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') {
    throw new InvalidPayoutQueryError(
      `${field} arrived as a JavaScript number. Money columns must cross as strings — a settlement aggregate past `
      + '2^53 minor units has already lost precision by the time any check sees it');
  }
  if (typeof v !== 'string' || !/^-?[0-9]{1,19}$/.test(v.trim())) {
    throw new InvalidPayoutQueryError(`${field} could not be read as a whole number of minor units`);
  }
  return BigInt(v.trim());
}

/** A cycle date from the console. `YYYY-MM-DD` only — a settlement cycle is a business day, and accepting a timestamp
 *  would invite a caller to pass a moment and get a period. */
export function parseCycleDate(v: string | undefined, field: string): string | null {
  if (!v) return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new InvalidPayoutQueryError(`${field} must be a date as YYYY-MM-DD; a settlement cycle is a business day`);
  }
  // Round-trip through Date to reject 2026-02-31, which the regex accepts. `toISOString` is UTC and the string has no
  // time, so there is no zone shift to worry about here.
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new InvalidPayoutQueryError(`${field} is not a real date`);
  }
  return s;
}
