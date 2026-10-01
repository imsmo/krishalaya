// modules/payments/domain/auditor-ledger.ts · PC-56 TENANT-9c (F-10) · WHAT THE AUDITOR'S LEDGER MAY SAY (pure, no I/O).
//
// W436 draws every leg of a transaction with a running balance, a printed recompute and a "hash-chained" claim; W200
// says *"they can recompute the chain from the export"*. Two of those are true for a tenant and one is not:
//   • ZERO-SUM per transaction — true and checkable: Σ of the legs is printed as arithmetic, and a transaction whose legs
//     the tenant cannot all see says so (visible ≠ total) rather than footing the part it can.
//   • THE HASH LINK of a leg on an account the TENANT OWNS — true and checkable: the entry's hash is recomputed with the
//     writer's own function (`core/wallet/hash-chain.ts`, the one formula — ADMIN-6/TENANT-4a) and its `prev_hash` is
//     compared with the entry before it on that account. Genesis entries link to nothing and say so.
//   • THE HASH LINK of a leg on a PLATFORM account (escrow, fees, payouts …) — UNSATISFIABLE from one tenant. Those
//     accounts are shared by every tenant and striped (ADMIN-6, W059): an entry's predecessor is very likely ANOTHER
//     TENANT's money event, so verifying the link means reading the neighbour's row, and exporting it to make the chain
//     recomputable would be a leak. The link is WITHHELD BY NAME (`shared_stripe`), and so is the running balance after
//     the entry (it is the platform's balance across tenants). A member's wallet leg withholds the same two for the
//     member's privacy (`member_wallet`) and prints a masked identifier, never a name. Never a green tick over either.
import { entryHash } from '../../../core/wallet/hash-chain';

export type LegKind = 'tenant_own' | 'platform' | 'member_wallet' | 'other_tenant';

/** Whose account a leg sits on, from the ACCOUNT ROW (never from anything a caller sent). */
export function legKind(ownerKind: string, ownerTenantId: string | null, tenantId: string): LegKind {
  if (ownerKind === 'tenant') return ownerTenantId === tenantId ? 'tenant_own' : 'other_tenant';
  if (ownerKind === 'platform') return 'platform';
  return 'member_wallet';
}

export interface RawLeg {
  entryId: string; txnId: string; accountId: string; accountCode: string; ownerKind: string; ownerTenantId: string | null;
  ownerUserId: string | null; amountMinor: string; currencyCode: string; balanceAfterMinor: string; prevHash: string | null;
  entryHash: string; createdAt: string;
  /** For a tenant-own leg only: the entry_hash of the entry before this one on the same account; null = none (genesis). */
  predecessorHash: string | null;
}

export type HashLink =
  | { kind: 'linked'; genesis: boolean; prevHash: string | null; entryHash: string }
  | { kind: 'hash_mismatch'; prevHash: string | null; entryHash: string }
  | { kind: 'chain_break'; prevHash: string | null; predecessorHash: string | null; entryHash: string }
  | { kind: 'withheld'; reason: 'shared_stripe' | 'member_wallet' | 'other_tenant' };

/** THE DERIVATION. Only a tenant-own leg is judged; every other kind is withheld by name. */
export function hashLinkOf(leg: RawLeg, kind: LegKind): HashLink {
  if (kind === 'platform') return { kind: 'withheld', reason: 'shared_stripe' };
  if (kind === 'member_wallet') return { kind: 'withheld', reason: 'member_wallet' };
  if (kind === 'other_tenant') return { kind: 'withheld', reason: 'other_tenant' };
  const recomputed = entryHash(leg.prevHash, leg.txnId, leg.accountId, BigInt(leg.amountMinor), BigInt(leg.balanceAfterMinor));
  if (recomputed !== leg.entryHash) return { kind: 'hash_mismatch', prevHash: leg.prevHash, entryHash: leg.entryHash };
  if ((leg.predecessorHash ?? null) !== (leg.prevHash ?? null)) {
    return { kind: 'chain_break', prevHash: leg.prevHash, predecessorHash: leg.predecessorHash, entryHash: leg.entryHash };
  }
  return { kind: 'linked', genesis: leg.prevHash === null, prevHash: leg.prevHash, entryHash: leg.entryHash };
}

export interface LegView {
  n: number; entryId: string; kind: LegKind; accountCode: string;
  /** A member wallet prints `member ··<last 4 of the account id>` — a masked identifier, never a person. */
  accountLabel: string;
  side: 'Dr' | 'Cr' | 'zero'; amountMinor: string; runningMinor: string;
  /** The account's balance after this entry — only for an account the tenant owns. */
  balanceAfterMinor: string | null;
  hashLink: HashLink;
}

export interface TxnFoot { sumMinor: string; foots: boolean; legsVisible: number; legsTotal: number; complete: boolean; terms: string[] }

/** Σ of the legs, as the arithmetic the page prints; `complete` only when every leg of the transaction is visible. */
export function footOf(amounts: readonly string[], legsTotal: number): TxnFoot {
  let sum = 0n;
  for (const a of amounts) sum += BigInt(a);
  const complete = amounts.length === legsTotal && legsTotal > 1;
  return { sumMinor: sum.toString(), foots: complete && sum === 0n, legsVisible: amounts.length, legsTotal, complete, terms: amounts.map((a) => a.toString()) };
}

/** One transaction's legs, in write order, with running balance and each leg's verdict. */
export function viewLegs(legs: readonly RawLeg[], tenantId: string): LegView[] {
  let running = 0n;
  return legs.map((l, i) => {
    const kind = legKind(l.ownerKind, l.ownerTenantId, tenantId);
    const amt = BigInt(l.amountMinor);
    running += amt;
    return {
      n: i + 1, entryId: l.entryId, kind, accountCode: kind === 'other_tenant' ? 'other_tenant' : l.accountCode,
      accountLabel: kind === 'member_wallet' ? `member ··${l.accountId.replace(/-/g, '').slice(-4)}` : kind === 'other_tenant' ? 'withheld' : l.accountCode,
      side: amt < 0n ? 'Dr' : amt > 0n ? 'Cr' : 'zero',
      amountMinor: amt.toString(), runningMinor: running.toString(),
      balanceAfterMinor: kind === 'tenant_own' ? l.balanceAfterMinor : null,
      hashLink: hashLinkOf(l, kind),
    };
  });
}

/** W200's integrity tile in words: what was checked, and what could not be. Never "verified" over a withheld link. */
export interface IntegrityVerdict {
  zeroSum: { checked: number; foot: number; notFoot: number; incomplete: number };
  ownLinks: { checked: number; linked: number; broken: number };
  withheld: { sharedStripe: number; memberWallet: number; otherTenant: number };
}

export function integrityOf(txns: ReadonlyArray<{ foot: TxnFoot; legs: readonly LegView[] }>): IntegrityVerdict {
  const v: IntegrityVerdict = { zeroSum: { checked: 0, foot: 0, notFoot: 0, incomplete: 0 }, ownLinks: { checked: 0, linked: 0, broken: 0 }, withheld: { sharedStripe: 0, memberWallet: 0, otherTenant: 0 } };
  for (const t of txns) {
    v.zeroSum.checked += 1;
    if (!t.foot.complete) v.zeroSum.incomplete += 1;
    else if (t.foot.foots) v.zeroSum.foot += 1;
    else v.zeroSum.notFoot += 1;
    for (const l of t.legs) {
      const h = l.hashLink;
      if (h.kind === 'withheld') {
        if (h.reason === 'shared_stripe') v.withheld.sharedStripe += 1;
        else if (h.reason === 'member_wallet') v.withheld.memberWallet += 1;
        else v.withheld.otherTenant += 1;
      } else {
        v.ownLinks.checked += 1;
        if (h.kind === 'linked') v.ownLinks.linked += 1; else v.ownLinks.broken += 1;
      }
    }
  }
  return v;
}

/** Balance = Σ, for an account the tenant owns: the cached balance against the ledger's own sum (ADMIN-6's drift check). */
export function balanceEqualsSum(cachedMinor: string, ledgerSumMinor: string): { equal: boolean; driftMinor: string } {
  const d = BigInt(cachedMinor) - BigInt(ledgerSumMinor);
  return { equal: d === 0n, driftMinor: d.toString() };
}
