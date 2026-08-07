// apps/admin-api/src/modules/ledger-ops/domain/hash-chain.ts · the verifier, PURE (PC-56 ADMIN-6).
//
// ---------------------------------------------------------------------------
// THE FIRST CODE ON THIS PLATFORM THAT READS `prev_hash`
// ---------------------------------------------------------------------------
// Every ledger entry has carried `prev_hash` and `entry_hash` since 0006. Nothing has ever recomputed one, compared
// one, or SELECTed `prev_hash` at all — `wallet_accounts.last_entry_hash` is read in exactly one place, `lockAccount`,
// and only to EXTEND the chain. W064 offers "Verify chain (period)", W065 offers "Verify hashes" and calls a mismatch
// "a P0 incident, not a retry", and W006 prints "hash chain intact". All three were assertions with nothing behind
// them: **"tamper-evident" was a comment.**
//
// ---------------------------------------------------------------------------
// THIS IS THE THIRD COPY OF THE FORMULA, AND THAT IS THE MOST DANGEROUS THING ABOUT IT
// ---------------------------------------------------------------------------
// The two originals:
//   • apps/wallet-service/src/ledger/hash-chain.ts        — exported, used by the gRPC money writer
//   • apps/api/src/core/wallet/wallet.client.inprocess.ts — a PRIVATE, unexported duplicate
//
// A verifier that disagrees with the writers is worse than no verifier: it would report a healthy ledger as tampered,
// and a P0 page over a formula mismatch is how a team learns to ignore the alarm. So the preimage is written out
// character by character below with both source paths named, and consolidating the three into one shared package is
// filed as ADMIN-6-Q2 rather than attempted here — that change touches the only two money writers on the platform and
// deserves its own wave.
//
// THE PREIMAGE, EXACTLY:  `${prev ?? ''}|${txnId}|${accountId}|${amountMinor}|${balanceAfterMinor}`
// sha256, hex digest. bigints are base-10 with a leading `-` when negative (template interpolation of a JS bigint).
// A NULL `prev_hash` becomes the EMPTY STRING, not the text "null" — that is the genesis entry of an account's chain.
//
// WHAT THE PREIMAGE DOES NOT CONTAIN, because a verifier must not imply guarantees the hash does not give:
// `tenant_id`, `currency_code`, `created_at`, the entry's own id, and any sequence number. So the chain proves the
// ORDER and the AMOUNTS of an account's entries were not altered; it does not prove that an entry was not backdated,
// and two genuinely identical legs of one transaction hash identically. That second point is why no unique index on
// `entry_hash` was added in 0113 and is filed as ADMIN-6-Q1.
import { createHash } from 'node:crypto';

/** The verifier's copy of the writers' formula. Kept byte-identical to
 *  `apps/wallet-service/src/ledger/hash-chain.ts` — see this file's header for why that matters more than the
 *  duplication does. */
export function entryHash(
  prev: string | null,
  txnId: string,
  accountId: string,
  amountMinor: bigint,
  balanceAfterMinor: bigint,
): string {
  return createHash('sha256')
    .update(`${prev ?? ''}|${txnId}|${accountId}|${amountMinor}|${balanceAfterMinor}`)
    .digest('hex');
}

export const HASH_PREIMAGE = 'sha256(prev ‖ txn_id ‖ account_id ‖ amount_minor ‖ balance_after_minor)' as const;
export const WRITER_SOURCES = Object.freeze([
  'apps/wallet-service/src/ledger/hash-chain.ts',
  'apps/api/src/core/wallet/wallet.client.inprocess.ts',
]);

/** One entry as the verifier needs it. Amounts arrive as STRINGS from `pg` (bigint columns) and become bigint here —
 *  never `Number`, because a balance beyond 2^53 would hash differently after a lossy conversion and the verifier
 *  would report a tamper that did not happen. */
export interface ChainEntry {
  id: string;                 // bigserial, as a string
  txnId: string;
  accountId: string;
  amountMinor: bigint;
  balanceAfterMinor: bigint;
  prevHash: string | null;
  entryHash: string;
  createdAt: string;
}

export type ChainOutcome = 'intact' | 'broken' | 'incomplete';

export type ChainResult =
  | { outcome: 'intact'; entriesChecked: number; headHash: string | null }
  /** The window began mid-chain, so the walk has no anchor: the first entry's `prev_hash` points at something outside
   *  the window and cannot be confirmed. Reported as its own outcome rather than as `intact` — a bounded verification
   *  that claims the chain is whole is exactly the overstatement this module exists to remove. */
  | { outcome: 'incomplete'; entriesChecked: number; headHash: string | null; reason: string }
  | {
    outcome: 'broken'; entriesChecked: number; headHash: string | null;
    brokenAtEntryId: string; expectedHash: string; storedHash: string; kind: 'hash_mismatch' | 'chain_break';
  };

/**
 * Walk one account's chain in ascending order and recompute every hash.
 *
 * TWO DISTINCT FAILURES, and they are reported separately because they mean different things to a responder:
 *   • `hash_mismatch` — the stored `entry_hash` is not what the stored fields hash to. Somebody EDITED a row.
 *   • `chain_break`   — the entry's `prev_hash` is not the previous entry's `entry_hash`. Somebody INSERTED or
 *                       REMOVED a row, or two writers forked the chain.
 * Collapsing them into "broken" would send the same page for "a row was altered" and "a row is missing", which are
 * different investigations.
 *
 * `expectFromGenesis` is the caller's claim that the first entry given is the account's first ever. When false, a
 * first entry with a non-null `prev_hash` is `incomplete` rather than a break — because it is unverifiable, not wrong.
 */
export function verifyChain(entries: readonly ChainEntry[], expectFromGenesis: boolean): ChainResult {
  if (entries.length === 0) {
    // An account with no entries in the window has nothing to verify, and saying `intact` would be a claim about
    // nothing. `incomplete` with the reason is the truthful reading.
    return { outcome: 'incomplete', entriesChecked: 0, headHash: null, reason: 'no entries in the window' };
  }

  let prev: string | null = null;
  let checked = 0;
  let anchored = true;

  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];

    // 1. DOES THE ROW HASH TO WHAT IT SAYS? Checked FIRST, and on every entry including the first: an edited genesis
    //    row would otherwise pass unexamined in a window that begins mid-chain.
    const recomputed = entryHash(e.prevHash, e.txnId, e.accountId, e.amountMinor, e.balanceAfterMinor);
    if (recomputed !== e.entryHash) {
      return {
        outcome: 'broken', entriesChecked: checked, headHash: entries[entries.length - 1].entryHash,
        brokenAtEntryId: e.id, expectedHash: recomputed, storedHash: e.entryHash, kind: 'hash_mismatch',
      };
    }

    // 2. DOES IT LINK TO THE ONE BEFORE IT?
    if (i === 0) {
      if (expectFromGenesis) {
        // The genesis entry of an account's chain has a NULL prev_hash. A non-null one here means entries before this
        // point existed and are gone.
        if (e.prevHash !== null) {
          return {
            outcome: 'broken', entriesChecked: checked, headHash: entries[entries.length - 1].entryHash,
            brokenAtEntryId: e.id, expectedHash: '', storedHash: e.prevHash, kind: 'chain_break',
          };
        }
      } else if (e.prevHash !== null) {
        // Mid-chain start: the link cannot be confirmed, so the whole walk is downgraded rather than the entry being
        // called a break. The flag is set and the loop continues — the rest of the window is still worth checking, and
        // a hash mismatch further along is still a real finding.
        anchored = false;
      }
    } else if (e.prevHash !== prev) {
      return {
        outcome: 'broken', entriesChecked: checked, headHash: entries[entries.length - 1].entryHash,
        brokenAtEntryId: e.id, expectedHash: prev ?? '', storedHash: e.prevHash ?? '', kind: 'chain_break',
      };
    }

    prev = e.entryHash;
    checked += 1;
  }

  const headHash = entries[entries.length - 1].entryHash;
  if (!anchored) {
    return {
      outcome: 'incomplete', entriesChecked: checked, headHash,
      reason: 'the window begins mid-chain, so the first entry\'s link to the one before it could not be confirmed',
    };
  }
  return { outcome: 'intact', entriesChecked: checked, headHash };
}

/** Does the walk's last hash match the head the account claims?
 *
 *  A SEPARATE CHECK FROM THE WALK, and worth stating why. `verifyChain` proves the entries given are a consistent
 *  chain; this proves that chain is the whole of it. A tamperer who truncated the ledger and rewrote
 *  `last_entry_hash` to match would pass the walk — the remaining entries would be perfectly consistent — and fail
 *  here only if the head disagreed. Which is to say this check is weak on its own and is the only thing that notices a
 *  chain that has been shortened, so it is reported rather than folded into the outcome.
 */
export type HeadCheck =
  | { kind: 'matches' }
  | { kind: 'differs'; walked: string | null; claimed: string | null }
  | { kind: 'unknown'; reason: string };

export function checkHead(walkedHead: string | null, claimedHead: string | null, walkedToEnd: boolean): HeadCheck {
  if (!walkedToEnd) {
    return { kind: 'unknown', reason: 'the walk was bounded, so its last entry is not expected to be the account head' };
  }
  if (!claimedHead) {
    return { kind: 'unknown', reason: 'the account records no head hash, so there is nothing to compare against' };
  }
  return walkedHead === claimedHead ? { kind: 'matches' } : { kind: 'differs', walked: walkedHead, claimed: claimedHead };
}

/* ------------------------------------------------------------------------------------------------ */
/* THE ZERO-SUM OF ONE TRANSACTION — W065's "Σ minor = … = 0 ✓"                                      */
/* ------------------------------------------------------------------------------------------------ */

export type TxnBalance =
  | { balanced: true; sumMinor: bigint; legCount: number }
  | { balanced: false; sumMinor: bigint; legCount: number }
  | { balanced: false; sumMinor: bigint; legCount: number; tooFewLegs: true };

/** Recomputed from the legs on every read of W065, not trusted from a status column.
 *
 *  There is no `is_balanced` column on `ledger_transactions` and there should not be: a stored flag is a claim that
 *  can disagree with the rows it describes, and this screen exists precisely to show the rows. One leg is never
 *  balanced even at zero — a transaction is a transfer, and a single zero leg summing to zero is arithmetically true
 *  and financially meaningless.
 */
export function txnBalance(amounts: readonly bigint[]): TxnBalance {
  const sum = amounts.reduce((a, x) => a + x, 0n);
  if (amounts.length < 2) return { balanced: false, sumMinor: sum, legCount: amounts.length, tooFewLegs: true };
  return sum === 0n
    ? { balanced: true, sumMinor: sum, legCount: amounts.length }
    : { balanced: false, sumMinor: sum, legCount: amounts.length };
}

/** W065 prints the arithmetic: `−4860000 + 72900 + 48600 + 4738500 = 0`. Built from the legs in order, so a reader can
 *  check it by eye — which is the entire point of showing it rather than a tick. */
export function balanceEquation(amounts: readonly bigint[]): string {
  if (amounts.length === 0) return '';
  const head = amounts[0].toString();
  const rest = amounts.slice(1).map((a) => (a < 0n ? `− ${-a}` : `+ ${a}`)).join(' ');
  const sum = amounts.reduce((a, x) => a + x, 0n);
  return `${head}${rest ? ` ${rest}` : ''} = ${sum}`;
}
