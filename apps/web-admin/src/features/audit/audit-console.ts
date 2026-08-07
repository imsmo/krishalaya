// apps/web-admin/src/features/audit/audit-console.ts · PURE helpers for W039, W040 and W068 (PC-56 ADMIN-5e).
// No fetch, no React → unit-tested.
//
// Two screens with the same governing idea. W039: "Nothing here can be edited or deleted — by anyone." W068:
// "There is no delete. A wrong correction is fixed by another correction — the ledger tells the whole story
// forever." Both are surfaces whose value is that they cannot be tidied up, and the console's job on both is to
// avoid rendering a tidier story than the data supports.

/* ===================== W039 / W040 · the audit trail ===================== */

export type SavedView = 'all' | 'writes' | 'money';
export const SAVED_VIEWS: readonly SavedView[] = ['all', 'writes', 'money'];
export function isSavedView(v: unknown): v is SavedView {
  return typeof v === 'string' && (SAVED_VIEWS as readonly string[]).includes(v);
}

export type DiffKind = 'added' | 'removed' | 'changed';
export interface DiffLine { kind: DiffKind; key: string; before: string | null; after: string | null }
export type DiffPanel =
  | { kind: 'not_recorded' }
  | { kind: 'masked'; keys: string[] }
  | { kind: 'created'; lines: DiffLine[] }
  | { kind: 'diff'; lines: DiffLine[] }
  | { kind: 'opaque'; before: string | null; after: string | null };

export const MASK = '▪▪▪' as const;

/** Which of W040's five diff states to render.
 *
 *  `not_recorded` and an EMPTY diff are separate keys and that is the whole point of this function. "Nothing was
 *  recorded about what changed" and "we recorded the before and after and they were identical" are opposite facts
 *  about whether the platform knows what a privileged action did, and one message for both would hide the first —
 *  which is the state of nearly every row.
 */
export function diffStateKey(p: DiffPanel | null | undefined): 'notRecorded' | 'masked' | 'created' | 'diff' | 'opaque' | 'empty' {
  if (!p) return 'notRecorded';
  if (p.kind === 'not_recorded') return 'notRecorded';
  if (p.kind === 'masked') return p.keys.length === 0 ? 'notRecorded' : 'masked';
  if (p.kind === 'opaque') return 'opaque';
  if (p.kind === 'created') return p.lines.length === 0 ? 'empty' : 'created';
  return p.lines.length === 0 ? 'empty' : 'diff';
}

/** The +/− marker W040 prints. A REMOVED key is `−`, and it is the line most likely to be missing from a diff
 *  somebody wrote quickly. */
export function diffSign(k: DiffKind): '+' | '−' | '±' {
  if (k === 'added') return '+';
  if (k === 'removed') return '−';
  return '±';
}
export function diffLineClass(k: DiffKind): string {
  if (k === 'added') return 'kv-status kv-status--ok';
  if (k === 'removed') return 'kv-status kv-status--danger';
  return 'kv-status kv-status--warn';
}

/** What to print in a value cell. Masked panels render the MASK, never an empty cell — a blank looks like a value
 *  that was absent rather than one that was withheld, and those carry opposite implications about the row. */
export function valueCell(v: string | null, masked: boolean): string {
  if (masked) return MASK;
  return v ?? '—';
}

/** W039's action filter and the money view are SERVER-side. This is only the chip's active state. */
export function viewChipClass(current: SavedView, chip: SavedView): string {
  return current === chip ? 'kv-chip is-active' : 'kv-chip';
}

/** The retention line. W039 claims "7-year immutable retention"; the platform honours half of it, and the console
 *  prints which half rather than repeating the claim. */
export function retentionKey(r: { immutable?: boolean; yearsEnforced?: boolean } | null | undefined): 'immutableOnly' | 'both' | 'unknown' {
  if (!r || typeof r.immutable !== 'boolean' || typeof r.yearsEnforced !== 'boolean') return 'unknown';
  return r.immutable && r.yearsEnforced ? 'both' : r.immutable ? 'immutableOnly' : 'unknown';
}

/** W039's window rule, checked before the request so the operator is told at the form rather than after a scan.
 *  A missing `from` is fine — the server defaults to today, which is the partition-pruning rule. */
export const MAX_LIVE_WINDOW_DAYS = 90;
export function windowTooWide(from: string | undefined, to: string | undefined, now: Date): boolean {
  if (!from) return false;
  const f = Date.parse(from);
  if (!Number.isFinite(f)) return false;          // let the server refuse a malformed date, with its own message
  const t = to ? Date.parse(to) : now.getTime();
  if (!Number.isFinite(t)) return false;
  return (t - f) / 86_400_000 > MAX_LIVE_WINDOW_DAYS;
}

/* ===================== W068 · the manual correction ===================== */

export type DraftStatus = 'drafting' | 'awaiting_checker' | 'posted' | 'rejected' | 'withdrawn';

export interface LegView {
  ownerKind: string; ownerId: string | null; accountCode: string;
  amountMinor: string; amountText: string; legNote: string | null;
}
export interface BalanceView {
  sumMinor: string; sumText: string; balanced: boolean; legCount: number;
  grossMinor: string; grossText: string;
}
export type SubmitState =
  | { ok: true; gross: string; needsFounderConfirmation: boolean }
  | { ok: false; reason: 'not_drafting' | 'no_reason' }
  | { ok: false; reason: 'too_few_legs'; legCount: number }
  | { ok: false; reason: 'unbalanced'; sumMinor: string };
export type ApproveState =
  | { ok: true }
  | { ok: false; reason: 'not_submitted' | 'already_decided' }
  | { ok: false; reason: 'unbalanced'; sumMinor: string };

/** W068's stepper: Evidence → Draft legs → Checker approval → Posted. Which step is live.
 *
 *  A REJECTED or WITHDRAWN draft is not "back at step 2" — it is finished, and showing it mid-flow would invite
 *  somebody to carry on with a correction a checker refused.
 */
export function stepOf(status: DraftStatus | null | undefined, balanced: boolean): 1 | 2 | 3 | 4 | null {
  if (status === 'posted') return 4;
  if (status === 'awaiting_checker') return 3;
  if (status === 'drafting') return balanced ? 2 : 2;
  return null;   // rejected / withdrawn / unknown — the flow is over
}

export function statusClass(s: DraftStatus | null | undefined): string {
  switch (s) {
    case 'posted': return 'kv-status kv-status--ok';
    case 'awaiting_checker': return 'kv-status kv-status--warn';
    case 'rejected': return 'kv-status kv-status--danger';
    case 'withdrawn': return 'kv-status kv-status--muted';
    case 'drafting': return 'kv-status kv-status--muted';
    default: return 'kv-status kv-status--muted';
  }
}

/** The Σ readout. BALANCED is the only green state; an unbalanced sum is a FAILURE, not a note in progress —
 *  W068's own state is "Legs do not balance — Σ = +12,450 ≠ 0. The form will not submit unbalanced." */
export function balanceClass(b: BalanceView | null | undefined): string {
  if (!b) return 'kv-status kv-status--muted';
  return b.balanced ? 'kv-status kv-status--ok' : 'kv-status kv-status--danger';
}
export function balanceText(b: BalanceView | null | undefined): string {
  if (!b) return '—';
  return b.balanced ? 'Σ = 0 ✓' : `Σ = ${b.sumText} ≠ 0`;
}

/** Why Submit is not offered. Distinct keys because the next move differs: add a leg, balance them, write a real
 *  reason, or nothing at all because the draft has moved on. */
export function submitBlockedKey(s: SubmitState | null | undefined): 'notDrafting' | 'tooFewLegs' | 'unbalanced' | 'noReason' | null {
  if (!s) return 'notDrafting';
  if (s.ok) return null;
  if (s.reason === 'too_few_legs') return 'tooFewLegs';
  if (s.reason === 'unbalanced') return 'unbalanced';
  if (s.reason === 'no_reason') return 'noReason';
  return 'notDrafting';
}

/** Why Approve is not offered. `yourOwn` is computed here rather than sent, because it depends on who is looking. */
export function approveBlockedKey(s: ApproveState | null | undefined, makerId: string | null | undefined, viewer: string | null | undefined):
  'notSubmitted' | 'alreadyDecided' | 'unbalanced' | 'yourOwn' | null {
  if (!s) return 'notSubmitted';
  if (!s.ok) {
    if (s.reason === 'already_decided') return 'alreadyDecided';
    if (s.reason === 'unbalanced') return 'unbalanced';
    return 'notSubmitted';
  }
  if (viewer && makerId && viewer === makerId) return 'yourOwn';
  return null;
}

/** Whether the checker must confirm the founder was told. Computed from the GROSS, as a string comparison on
 *  minor units — never by parsing the display text and never as a JS number. */
export const FOUNDER_THRESHOLD_MINOR = 5_000_000n;
export function aboveFounderThreshold(grossMinor: string | null | undefined): boolean {
  if (typeof grossMinor !== 'string' || !/^-?[0-9]{1,18}$/.test(grossMinor)) return false;
  const g = BigInt(grossMinor);
  return (g < 0n ? -g : g) >= FOUNDER_THRESHOLD_MINOR;
}

export type LegFormResult =
  | { ok: true; value: { ownerKind: string; ownerId?: string; accountCode: string; amountMinor: string; legNote?: string } }
  | { ok: false; error: 'ownerKind' | 'ownerId' | 'accountCode' | 'amount' | 'zeroAmount' };

/** Parse one leg out of the form.
 *
 *  THE AMOUNT IS KEPT AS A STRING FROM THE INPUT TO THE WIRE. It is validated by regex and never passed through
 *  `Number()` or `parseInt` — not for the range check, not for the sign, not for anything. The moment a rupee
 *  figure becomes a JS number it may already have lost its last digit, and every check after that point is being
 *  run against a value that is no longer the one the operator typed.
 */
export function buildLeg(raw: { ownerKind?: string; ownerId?: string; accountCode?: string; amountMinor?: string; legNote?: string }): LegFormResult {
  const ownerKind = (raw.ownerKind ?? '').trim();
  if (!['user', 'tenant', 'platform'].includes(ownerKind)) return { ok: false, error: 'ownerKind' };
  const ownerId = (raw.ownerId ?? '').trim();
  if (ownerKind === 'platform' ? !!ownerId : !ownerId) return { ok: false, error: 'ownerId' };
  const accountCode = (raw.accountCode ?? '').trim();
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(accountCode)) return { ok: false, error: 'accountCode' };

  const amountMinor = (raw.amountMinor ?? '').trim().replace(/[\s,]/g, '');
  if (!/^-?[0-9]{1,18}$/.test(amountMinor)) return { ok: false, error: 'amount' };
  // A string of zeros is zero however it is written, and `-0` is too.
  if (/^-?0+$/.test(amountMinor)) return { ok: false, error: 'zeroAmount' };

  const legNote = (raw.legNote ?? '').trim();
  return {
    ok: true,
    value: {
      ownerKind, accountCode, amountMinor,
      ...(ownerId ? { ownerId } : {}),
      ...(legNote ? { legNote } : {}),
    },
  };
}

/** The client-side Σ, for the live readout beside the legs.
 *
 *  BigInt arithmetic, so a ₹90-crore correction sums correctly in the browser too. An invalid amount makes the
 *  whole sum UNKNOWN rather than being skipped — skipping it would show a balanced Σ over a set that contains a
 *  leg the server will reject, which is the most misleading possible state of this readout.
 */
export function sumLegs(amounts: readonly string[]): { known: boolean; sumMinor: string } {
  let sum = 0n;
  for (const a of amounts) {
    const s = (a ?? '').trim().replace(/[\s,]/g, '');
    if (!/^-?[0-9]{1,18}$/.test(s)) return { known: false, sumMinor: '0' };
    sum += BigInt(s);
  }
  return { known: true, sumMinor: sum.toString() };
}

/** Minor units → a rupee string, for anything the server did not preformat. Takes and returns STRINGS. */
export function formatMinorText(minor: string | null | undefined, currency = 'INR'): string {
  if (typeof minor !== 'string' || !/^-?[0-9]{1,18}$/.test(minor.trim())) return '—';
  const v = BigInt(minor.trim());
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const sym = currency === 'INR' ? '₹' : '';
  return `${neg ? '−' : ''}${sym}${(abs / 100n).toLocaleString('en-IN')}.${(abs % 100n).toString().padStart(2, '0')}`;
}
