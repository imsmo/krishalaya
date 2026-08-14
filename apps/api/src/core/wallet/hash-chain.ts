// core/wallet/hash-chain.ts · THE ledger entry hash, in one place, imported by BOTH the writer and
// every verifier (PC-56 TENANT-4a).
//
// The formula has existed since 0006 as a private function inside wallet.client.inprocess.ts, and
// there are now copies of it in apps/wallet-service (the deploy target) and apps/admin-api (ADMIN-6's
// god-mode verifier). A verifier that disagrees with the writer is WORSE than no verifier at all: it
// pages somebody at 3am about a rounding difference in a string template and teaches them to ignore
// the alarm. So the tenant-realm verifier this wave adds does not carry its own copy — it imports
// `entryHash` from here, and so does the writer.
//
// NOT DONE, RECORDED: apps/wallet-service and apps/admin-api still hold their own copies. Both are
// separate deployables (a monorepo import across app boundaries is not free) and unifying them is a
// core/ extraction that must land with the wallet-service network cutover, not inside a UI wave.
import { createHash } from 'node:crypto';

/** sha256(prev ‖ txnId ‖ accountId ‖ signedAmount ‖ balanceAfter). A NULL prev (the genesis entry of
 *  an account's chain) hashes as the EMPTY STRING — never the text "null". */
export function entryHash(prev: string | null, txnId: string, accountId: string, amountMinor: bigint, balanceAfterMinor: bigint): string {
  return createHash('sha256').update(`${prev ?? ''}|${txnId}|${accountId}|${amountMinor}|${balanceAfterMinor}`).digest('hex');
}

export interface ChainEntry {
  id: string;
  txnId: string;
  accountId: string;
  amountMinor: string;        // bigint as string (never a JS number — Law 2)
  balanceAfterMinor: string;
  prevHash: string | null;
  entryHash: string;
  createdAt: string;
}

export type ChainVerdict =
  /** Every entry hashes to its stored `entry_hash` and every link matches. */
  | { kind: 'intact'; checked: number; lastHash: string | null }
  /** A stored `entry_hash` is not what the stored fields hash to: somebody EDITED a row. */
  | { kind: 'hash_mismatch'; checked: number; atEntryId: string }
  /** An entry's `prev_hash` is not the previous entry's `entry_hash`: somebody INSERTED or DELETED one. */
  | { kind: 'chain_break'; checked: number; atEntryId: string }
  /** The window opened mid-chain, so the first link has no anchor inside it. Unverifiable, NOT wrong —
   *  and reported as its own word, because "we could not check" must never render as "intact". */
  | { kind: 'incomplete'; checked: number; reason: 'window_opened_mid_chain' }
  /** No entries in range. Also not "intact": there is nothing to be intact. */
  | { kind: 'empty' };

/** Walk ONE account's entries, oldest first, recomputing every hash with the writer's own function.
 *  `anchored` says whether `entries[0]` is the true genesis of the account's chain (the caller knows:
 *  it either read from the beginning, or it passed the preceding entry's hash as `expectedFirstPrev`). */
export function verifyChain(entries: readonly ChainEntry[], expectedFirstPrev?: string | null): ChainVerdict {
  if (entries.length === 0) return { kind: 'empty' };
  const first = entries[0];
  if (expectedFirstPrev === undefined) {
    // No anchor was supplied: only a genesis entry (prev_hash IS NULL) proves the walk starts at the start.
    if (first.prevHash !== null) return { kind: 'incomplete', checked: 0, reason: 'window_opened_mid_chain' };
  } else if ((expectedFirstPrev ?? null) !== first.prevHash) {
    return { kind: 'chain_break', checked: 0, atEntryId: first.id };
  }

  let prev: string | null = first.prevHash;
  let checked = 0;
  for (const e of entries) {
    if (e.prevHash !== prev) return { kind: 'chain_break', checked, atEntryId: e.id };
    const recomputed = entryHash(prev, e.txnId, e.accountId, BigInt(e.amountMinor), BigInt(e.balanceAfterMinor));
    if (recomputed !== e.entryHash) return { kind: 'hash_mismatch', checked, atEntryId: e.id };
    prev = e.entryHash;
    checked += 1;
  }
  return { kind: 'intact', checked, lastHash: prev };
}

/** A truncation attack passes the walk: delete the tail, rewrite `wallet_accounts.last_entry_hash` to
 *  match, and every remaining entry is perfectly consistent. The only thing that catches it is the
 *  account row's own head pointer disagreeing with the last entry we can see — so a verdict is only
 *  worth printing next to this check. ADMIN-6 learned this in god mode; the tenant plane inherits it. */
export function headMatches(verdict: ChainVerdict, accountLastHash: string | null): boolean | null {
  if (verdict.kind !== 'intact') return null;          // nothing to compare against
  return (accountLastHash ?? null) === (verdict.lastHash ?? null);
}
