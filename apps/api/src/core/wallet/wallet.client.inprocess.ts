// core/wallet/wallet.client.inprocess.ts
// In-process implementation of the wallet-service gRPC contract (the active money path at
// shard_count=1; see apps/wallet-service for the deploy target). It is the ONLY writer of
// wallet_accounts + ledger_* (Law 2). Guarantees, in order:
//   1. ZERO-SUM: legs must sum to 0 (no money created/destroyed) — else hard fail.
//   2. SINGLE CURRENCY per txn; ≥2 legs; no zero-amount leg.
//   3. IDEMPOTENT: same idempotencyKey ⇒ the same txn, never double-posted (Law 3).
//   4. CONCURRENCY-SAFE: each account row is locked FOR UPDATE before its balance changes.
//   5. NO OVERDRAW of user/tenant accounts; frozen accounts reject debits.
//   6. TAMPER-EVIDENT: per-account hash chain (prev_hash → entry_hash).
import { Injectable } from '@nestjs/common';
import { TxContext } from '../database/unit-of-work';
import { WalletPort, PostTxnInput, PostTxnResult } from './wallet.port';
import { AccountRef } from './account-codes';
import { LedgerRepository } from './ledger.repository';
import { LedgerNotBalancedError, InvalidLedgerTxnError, InsufficientWalletBalanceError, WalletFrozenError } from './wallet.errors';
import { InfraError } from '../../shared/errors/app-error';
// PC-56 TENANT-4a: the hash formula moved to core/wallet/hash-chain.ts so the tenant-realm verifier
// computes it with THE WRITER'S OWN FUNCTION rather than a second copy that can drift from this one.
import { entryHash } from './hash-chain';

@Injectable()
export class InProcessWalletClient implements WalletPort {
  constructor(private readonly ledger: LedgerRepository) {}

  async post(tx: TxContext, input: PostTxnInput): Promise<PostTxnResult> {
    this.validate(input);

    // Resolve the txn-type lookup FIRST, as kv_app — lookup_values is a general reference
    // table that kv_wallet has no grant on (kv_wallet is scoped to money tables only).
    const txnTypeId = await this.ledger.txnTypeId(tx, input.txnType);
    if (!txnTypeId) throw new InvalidLedgerTxnError(`Unknown ledger_txn_type '${input.txnType}'`);

    // Law 2 privilege boundary: the API connection is the login role kv_app, which 0014
    // deliberately grants only SELECT on the ledger — it can NEVER write money. Only the
    // wallet may. Since this in-process client shares that connection, we transiently assume
    // kv_wallet (kv_app is a member of it — migration 0065) for the duration of the money
    // WRITES only, then drop straight back so any subsequent app SQL in the same tx is
    // kv_app again. SET LOCAL scopes the role to this tx, so a rollback/commit also unwinds it.
    await tx.query('SET LOCAL ROLE kv_wallet');
    try {
      const claim = await this.ledger.insertTxnIdempotent(tx, {
        txnTypeId, tenantId: input.tenantId, idempotencyKey: input.idempotencyKey,
        referenceType: input.referenceType, referenceId: input.referenceId, initiatedBy: input.initiatedBy, description: input.description,
      });
      if (claim.replayed) return { txnId: claim.id, alreadyApplied: true };   // idempotent no-op

      // Lock accounts in a deterministic order (by resolved id) to avoid deadlocks between concurrent txns.
      const resolved = await Promise.all(input.legs.map(async (leg) => ({ leg, accountId: await this.ledger.ensureAccountId(tx, leg.account) })));
      resolved.sort((a, b) => (a.accountId < b.accountId ? -1 : 1));

      const currency = input.legs[0].account.currencyCode ?? 'INR';
      for (const { leg, accountId } of resolved) {
        const acct = await this.ledger.lockAccount(tx, accountId);
        const balanceAfter = acct.balanceMinor + leg.amountMinor;
        if (leg.amountMinor < 0n && acct.isFrozen) throw new WalletFrozenError(leg.account.accountCode);
        if (balanceAfter < 0n && acct.kind !== 'platform') throw new InsufficientWalletBalanceError(leg.account.accountCode);
        const hash = entryHash(acct.lastHash, claim.id, accountId, leg.amountMinor, balanceAfter);
        await this.ledger.appendEntry(tx, { txnId: claim.id, accountId, tenantId: input.tenantId, amountMinor: leg.amountMinor, currencyCode: currency, balanceAfter, prevHash: acct.lastHash, entryHash: hash });
      }
      return { txnId: claim.id, alreadyApplied: false };
    } finally {
      // Drop back to the least-privilege app role for the rest of the tx.
      await tx.query('RESET ROLE').catch(() => undefined);
    }
  }

  async balanceMinor(tx: TxContext, account: AccountRef): Promise<bigint> {
    // ensureAccountId issues INSERT ... ON CONFLICT (needs INSERT privilege even when it
    // no-ops), so this read path must also assume kv_wallet then drop back. See post().
    await tx.query('SET LOCAL ROLE kv_wallet');
    try {
      const id = await this.ledger.ensureAccountId(tx, account);
      return await this.ledger.balanceOf(tx, id);
    } finally {
      await tx.query('RESET ROLE').catch(() => undefined);
    }
  }

  private validate(input: PostTxnInput): void {
    if (!input.idempotencyKey) throw new InvalidLedgerTxnError('idempotencyKey is required (Law 3)');
    if (input.legs.length < 2) throw new InvalidLedgerTxnError('a transaction needs at least 2 legs');
    const currencies = new Set(input.legs.map((l) => l.account.currencyCode ?? 'INR'));
    if (currencies.size > 1) throw new InvalidLedgerTxnError('all legs must share one currency');
    let sum = 0n;
    for (const l of input.legs) {
      if (l.amountMinor === 0n) throw new InvalidLedgerTxnError('a leg amount cannot be zero');
      sum += l.amountMinor;
    }
    if (sum !== 0n) throw new LedgerNotBalancedError(sum);
  }
}

/** Guard for callers: the wallet port must always run inside a tx (never auto-commit a money move). */
export function assertTx(tx: TxContext | undefined): TxContext {
  if (!tx) throw new InfraError('WALLET_NO_TX', 'wallet operations must run inside a unit-of-work tx');
  return tx;
}
