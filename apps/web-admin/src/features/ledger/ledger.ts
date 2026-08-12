// apps/web-admin/src/features/ledger/ledger.ts · PURE helpers for W059/W064/W065 (PC-56 ADMIN-6).
// No fetch, no React → unit-tested.
import { formatMoneyMinor } from '@krishalaya/i18n';
//
// W064 calls the ledger "the single source of money truth". Three things follow, and every helper here defends one:
//   • A HASH CLAIM IS WORTH THE LAST TIME SOMEBODY CHECKED. "intact" with no date is what these screens printed for
//     as long as they have existed, while nothing on the platform read `prev_hash` at all.
//   • A BROKEN CHAIN IS A P0, not a retry. W065 says so in those words, and the console must not offer a refresh where
//     it should be raising an incident.
//   • A Σ OVER STRIPES SAYS HOW MUCH OF THE MONEY IT IS SURE ABOUT. A confident total over a stripe set with a hole in
//     it under-reports the platform's money with nothing on screen admitting it.

/* ===================== money ===================== */

/** Minor units → a localized currency string, from a STRING. DEV-56 Part 5: delegates to the canonical
 *  `formatMoneyMinor` (`@krishalaya/i18n`, already the standing formatter for billing/plans/tenants elsewhere in
 *  this app) instead of hand-rolling the bigint math again. The hand-rolled version this replaced divided by a
 *  hardcoded `100n` (wrong for a 0-decimal currency like JPY/KRW/VND or a 3-decimal one like BHD/KWD/OMR/JOD/TND)
 *  and rendered EVERY non-INR currency with NO symbol at all (`currency === 'INR' ? '₹' : ''`) — silently
 *  mislabelling any non-INR ledger leg as a bare number. The malformed-input guard is unchanged (same regex), so a
 *  bad string still degrades to '—' before ever reaching the formatter. One disclosed, intentional behaviour change:
 *  a negative amount's sign is now `-` (what `formatMoneyMinor`/Intl actually emit for en-IN, verified directly —
 *  ICU's own `minusSign` part for this locale IS the ASCII hyphen, not U+2212) rather than the U+2212 this file used
 *  to hardcode; this matches every other money surface in the app that already calls `formatMoneyMinor` directly. */
export function formatMinor(minor: string | null | undefined, currency = 'INR'): string {
  if (typeof minor !== 'string' || !/^-?[0-9]{1,19}$/.test(minor.trim())) return '—';
  return formatMoneyMinor(minor.trim(), currency);
}

/** A hash for display. The API returns all 64 characters because a responder comparing hashes needs them; the
 *  truncation belongs here, on the screen, and never on the wire. */
export function shortHash(h: string | null | undefined): string {
  if (typeof h !== 'string' || h.length < 8) return '—';
  return `${h.slice(0, 4)}…${h.slice(-2)}`;
}

/* ===================== W064 · the explorer ===================== */

export interface TxnRow {
  id: string; txnType: string | null; tenantId: string | null;
  referenceType: string | null; referenceId: string | null; description: string | null;
  idempotencyKey: string | null; initiatedBy: string | null; createdAt: string;
  legCount: number | null; magnitudeMinor: string | null; magnitudeText: string | null;
  txnTypeResolved: boolean;
}

/** The reference cell, in W064's `statement/ST-2026-0713-0214` shape. Both halves or nothing — a bare id with no type
 *  tells a reader which row to click and nothing about what they are looking at. */
export function referenceText(t: Pick<TxnRow, 'referenceType' | 'referenceId'>): string {
  if (!t.referenceType || !t.referenceId) return '—';
  return `${t.referenceType}/${t.referenceId}`;
}

/** An unresolvable txn type is a FAILURE, not a blank. `txn_type_id` is a NOT NULL FK to `lookup_values`, so a missing
 *  code means the join failed — a data fault, not a transaction without a type. A blank cell would read as the
 *  second. */
export function txnTypeCell(t: Pick<TxnRow, 'txnType' | 'txnTypeResolved'>): { known: boolean; text: string } {
  return t.txnTypeResolved && t.txnType ? { known: true, text: t.txnType } : { known: false, text: 'unresolved type' };
}

/** The magnitude cell. NEVER a Σ: a healthy transaction's legs sum to zero, so a sum column would read ₹0.00 on every
 *  row and tell an operator scanning for a large movement nothing at all.
 *
 *  DEV-56 Part 5 DATA GAP (disclosed, not silently patched): `TxnRow` carries no currency code — each `Leg` does
 *  (`currencyCode` on the `Leg` interface below), but the txn-list view this cell renders never surfaces one, so
 *  `formatMinor` falls through to its INR default here. That is today's real behaviour (this platform is INR-only
 *  in production) and not a regression from the pre-DEV-56 code, which had the identical gap — flagged so a future
 *  multi-currency ledger wave adds `currencyCode` to the list query rather than assuming this cell already reads it. */
export function magnitudeText(t: Pick<TxnRow, 'magnitudeMinor' | 'magnitudeText'>): string {
  if (t.magnitudeText) return t.magnitudeText;
  return formatMinor(t.magnitudeMinor);
}

/** W064: "Date filters default today (partition pruning)". Checked before the request so the operator is told at the
 *  form rather than after a scan they then wait out. */
export const MAX_LIVE_WINDOW_DAYS = 31;
export function windowTooWide(from: string | undefined, to: string | undefined, now: Date): boolean {
  if (!from) return false;
  const f = Date.parse(from);
  if (!Number.isFinite(f)) return false;      // let the server refuse a malformed date, with its own message
  const t = to ? Date.parse(to) : now.getTime();
  if (!Number.isFinite(t)) return false;
  return (t - f) / 86_400_000 > MAX_LIVE_WINDOW_DAYS;
}

/* ===================== W065 · one transaction ===================== */

export interface Leg {
  id: string; accountId: string; accountCode: string | null; ownerKind: string | null;
  shardNo: number | null; tenantId: string | null; currencyCode: string;
  amountMinor: string; amountText: string;
  balanceAfterMinor: string; balanceAfterText: string;
  prevHash: string | null; entryHash: string; createdAt: string;
}
export interface TxnBalance {
  balanced: boolean; sumMinor: string; sumText: string; legCount: number;
  tooFewLegs: boolean; equation: string;
}

/** The Σ readout. BALANCED is the only green state; an unbalanced transaction is a FAILURE and not a note in
 *  progress — an unbalanced ledger transaction means money was created or destroyed, which W006's alert calls
 *  page-immediately. */
export function balanceClass(b: TxnBalance | null | undefined): string {
  if (!b) return 'kv-status kv-status--muted';
  return b.balanced ? 'kv-status kv-status--ok' : 'kv-status kv-status--danger';
}
export function balanceLabel(b: TxnBalance | null | undefined): string {
  if (!b) return '—';
  if (b.tooFewLegs) return 'fewer than two legs';
  return b.balanced ? 'Σ = 0 verified' : `Σ = ${b.sumText} ≠ 0`;
}

/** A leg's direction, for the sign column. Read from the STRING, not from a parsed number — the sign of a
 *  beyond-precision amount must not depend on a lossy conversion. */
export function legDirection(amountMinor: string | null | undefined): 'credit' | 'debit' | 'unknown' {
  if (typeof amountMinor !== 'string' || !/^-?[0-9]{1,19}$/.test(amountMinor.trim())) return 'unknown';
  const s = amountMinor.trim();
  // TWO MUTANTS SURVIVED HERE AND BOTH ARE GENUINELY EQUIVALENT — recorded because the second one caught me writing a
  // confidently wrong explanation for the first.
  //
  // Replacing `startsWith('-')` with `Number(s) < 0` changes nothing, and neither does swapping the two lines. I first
  // wrote that the ordering was load-bearing because a numeric test "would call `-0` a credit" — it would not. `-0 < 0`
  // is FALSE in JavaScript, so the numeric form simply falls through to the zero check and lands on the same answer.
  // The regex above has already narrowed `s` to a plain integer string, and over that domain the string and numeric
  // tests are indistinguishable in both orders.
  //
  // `startsWith('-')` is therefore kept for CLARITY, not correctness: it needs no reasoning about numeric conversion on
  // a money value at all, which is the property worth having on this plane even where it buys nothing. Noted so nobody
  // reads the equivalence as a latent bug — or "fixes" it back.
  if (/^-0+$/.test(s) || /^0+$/.test(s)) return 'unknown';   // a zero leg cannot exist; if one appears, say so
  return s.startsWith('-') ? 'debit' : 'credit';
}
export function legClass(d: ReturnType<typeof legDirection>): string {
  if (d === 'credit') return 'kv-status kv-status--ok';
  if (d === 'debit') return 'kv-status kv-status--warn';
  // A zero or unreadable leg is a data fault on the one table that must not have them.
  return 'kv-status kv-status--danger';
}

/* ===================== the chain ===================== */

export type ChainOutcome = 'intact' | 'broken' | 'incomplete';
export interface VerifyResult {
  verificationId: string; accountId: string; accountCode: string | null;
  outcome: ChainOutcome; entriesChecked: number; fromGenesis: boolean; truncated: boolean;
  walkLimit: number;
  headCheck: { kind: 'matches' } | { kind: 'differs'; walked: string | null; claimed: string | null } | { kind: 'unknown'; reason: string };
  brokenAtEntryId?: string; expectedHash?: string; storedHash?: string; kind?: 'hash_mismatch' | 'chain_break';
  reason?: string; p0: boolean;
}

/** BROKEN is a failure and INCOMPLETE is a warning — not the same thing, and the difference is what an operator does
 *  next. Broken means raise an incident; incomplete means widen the window and run it again. */
export function outcomeClass(o: ChainOutcome | null | undefined): string {
  if (o === 'intact') return 'kv-status kv-status--ok';
  if (o === 'broken') return 'kv-status kv-status--danger';
  if (o === 'incomplete') return 'kv-status kv-status--warn';
  return 'kv-status kv-status--muted';
}

/** Which message the result gets. `broken` splits by KIND because "a row was edited" and "a row is missing" are
 *  different investigations, and one message for both would send a responder looking for the wrong thing. */
export function verifyMessageKey(r: VerifyResult | null | undefined):
  'none' | 'intact' | 'incomplete' | 'hashMismatch' | 'chainBreak' | 'headDiffers' {
  if (!r) return 'none';
  if (r.outcome === 'broken') return r.kind === 'chain_break' ? 'chainBreak' : 'hashMismatch';
  // A head that disagrees is reported even when the WALK was clean — it is the only thing that notices a ledger whose
  // tail was deleted and whose head hash was rewritten to match.
  if (r.headCheck?.kind === 'differs') return 'headDiffers';
  if (r.outcome === 'incomplete') return 'incomplete';
  return 'intact';
}

/** Whether the result is an incident rather than a reading. Drives the P0 banner, and is computed from BOTH the walk
 *  and the head check — a clean walk with a differing head is still a tampered ledger. */
export function isIncident(r: VerifyResult | null | undefined): boolean {
  if (!r) return false;
  return r.outcome === 'broken' || r.headCheck?.kind === 'differs';
}

export type ChainClaim =
  | { kind: 'verified'; outcome: 'intact' | 'incomplete'; at: string; entriesChecked: number }
  | { kind: 'broken'; at: string; entryId: string }
  | { kind: 'never' };

/** W006's and W059's "hash chain intact" cell. NEVER is the honest default and was the true state of every account on
 *  the platform: the claim was printed with nothing behind it. */
export function claimClass(c: ChainClaim | null | undefined): string {
  if (!c || c.kind === 'never') return 'kv-status kv-status--warn';
  if (c.kind === 'broken') return 'kv-status kv-status--danger';
  return c.outcome === 'intact' ? 'kv-status kv-status--ok' : 'kv-status kv-status--warn';
}
export function claimKey(c: ChainClaim | null | undefined): 'never' | 'broken' | 'intact' | 'incomplete' {
  if (!c || c.kind === 'never') return 'never';
  if (c.kind === 'broken') return 'broken';
  return c.outcome;
}

/* ===================== W059 · accounts ===================== */

export type Confidence =
  | { trustworthy: true; stripeCount: number }
  | { trustworthy: false; reason: 'missing_stripes'; missing: number[] }
  | { trustworthy: false; reason: 'fewer_than_configured'; found: number; configured: number };

export interface AccountGroup {
  accountCode: string; currencyCode: string; stripeCount: number;
  totalMinor: string; totalText: string; frozenStripes: number;
  shardNumbers: number[]; missingStripes: number[];
  confidence: Confidence;
  chain: { accountCode: string; claim: ChainClaim; stripesVerified: number; stripeCount: number } | null;
}

/** A Σ the platform is not sure about must not render as a plain number. Returns the reason key so the cell can carry
 *  it, because "₹8,64,12,480" and "₹8,64,12,480 over 15 of 16 stripes" are different facts about the same money. */
export function sumWarningKey(c: Confidence | null | undefined): 'missingStripes' | 'fewerThanConfigured' | null {
  if (!c || c.trustworthy) return null;
  return c.reason === 'missing_stripes' ? 'missingStripes' : 'fewerThanConfigured';
}
export function sumClass(c: Confidence | null | undefined): string {
  return !c || c.trustworthy ? 'kv-status kv-status--ok' : 'kv-status kv-status--danger';
}

/** How much of an account_code's chain has been verified. A code with 16 stripes and 1 verification is not "intact" —
 *  the claim covers a sixteenth of the money, and the fraction is the honest rendering. */
export function chainCoverage(c: AccountGroup['chain']): { known: boolean; verified: number; total: number } {
  if (!c || typeof c.stripesVerified !== 'number' || typeof c.stripeCount !== 'number' || c.stripeCount <= 0) {
    return { known: false, verified: 0, total: 0 };
  }
  return { known: true, verified: c.stripesVerified, total: c.stripeCount };
}

/** The per-account balance check. A DRIFT is a failure and the delta's sign matters: positive means the holder was
 *  shown more than the ledger says they have. */
export interface BalanceCheck {
  accountId: string; accountCode: string; ownerKind: string; shardNo: number;
  cachedMinor: string; cachedText: string; ledgerMinor: string; ledgerText: string;
  deltaMinor: string; deltaText: string; matches: boolean; truthSource: string;
}
export function driftClass(b: BalanceCheck | null | undefined): string {
  if (!b) return 'kv-status kv-status--muted';
  return b.matches ? 'kv-status kv-status--ok' : 'kv-status kv-status--danger';
}
export function driftDirection(deltaMinor: string | null | undefined): 'over' | 'under' | 'none' | 'unknown' {
  if (typeof deltaMinor !== 'string' || !/^-?[0-9]{1,19}$/.test(deltaMinor.trim())) return 'unknown';
  const v = BigInt(deltaMinor.trim());
  if (v === 0n) return 'none';
  // Positive delta = the cached balance is HIGHER than the ledger = the holder has been shown money they do not have.
  return v > 0n ? 'over' : 'under';
}
