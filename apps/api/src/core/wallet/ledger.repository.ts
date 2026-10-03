// core/wallet/ledger.repository.ts · ALL ledger/wallet SQL (the only place that writes
// wallet_accounts + ledger_*). Tables from db/migrations/0006_money.sql. Accounts are locked
// FOR UPDATE before their balance is read/changed (no lost updates under concurrency).
import { Injectable } from '@nestjs/common';
import { TxContext } from '../database/unit-of-work';
import { AccountRef } from './account-codes';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LockedAccount { id: string; balanceMinor: bigint; version: string; lastHash: string | null; isFrozen: boolean; kind: string; accountCode?: string; }

@Injectable()
export class LedgerRepository {
  /** Resolve the txn_type lookup id (platform value) for a ledger_txn_type code. */
  async txnTypeId(tx: TxContext, code: string): Promise<string | null> {
    const r = await tx.query<{ id: string }>(
      `SELECT id FROM lookup_values WHERE type_code='ledger_txn_type' AND tenant_id IS NULL AND code=$1 AND is_active=true`, [code]);
    return r.rows[0]?.id ?? null;
  }

  /** Get-or-create the account id for a ref (per-kind partial unique index inferred). */
  async ensureAccountId(tx: TxContext, a: AccountRef): Promise<string> {
    const cur = a.currencyCode ?? 'INR';
    if (a.kind === 'user') {
      await tx.query(
        `INSERT INTO wallet_accounts (owner_kind, owner_user_id, account_code, currency_code)
         VALUES ('user',$1,$2,$3) ON CONFLICT (owner_user_id, account_code, currency_code) WHERE owner_kind='user' DO NOTHING`,
        [a.userId, a.accountCode, cur]);
      const r = await tx.query<{ id: string }>(
        `SELECT id FROM wallet_accounts WHERE owner_kind='user' AND owner_user_id=$1 AND account_code=$2 AND currency_code=$3`,
        [a.userId, a.accountCode, cur]);
      return r.rows[0].id;
    }
    if (a.kind === 'tenant') {
      await tx.query(
        `INSERT INTO wallet_accounts (owner_kind, owner_tenant_id, account_code, currency_code)
         VALUES ('tenant',$1,$2,$3) ON CONFLICT (owner_tenant_id, account_code, currency_code) WHERE owner_kind='tenant' DO NOTHING`,
        [a.tenantId, a.accountCode, cur]);
      const r = await tx.query<{ id: string }>(
        `SELECT id FROM wallet_accounts WHERE owner_kind='tenant' AND owner_tenant_id=$1 AND account_code=$2 AND currency_code=$3`,
        [a.tenantId, a.accountCode, cur]);
      return r.rows[0].id;
    }
    // platform — shard 0 (hot-account striping is a documented next step; see README)
    await tx.query(
      `INSERT INTO wallet_accounts (owner_kind, account_code, currency_code, shard_no)
       VALUES ('platform',$1,$2,0) ON CONFLICT (account_code, currency_code, shard_no) WHERE owner_kind='platform' DO NOTHING`,
      [a.accountCode, cur]);
    const r = await tx.query<{ id: string }>(
      `SELECT id FROM wallet_accounts WHERE owner_kind='platform' AND account_code=$1 AND currency_code=$2 AND shard_no=0`,
      [a.accountCode, cur]);
    return r.rows[0].id;
  }

  /** Lock an account row and read its balance (FOR UPDATE — serializes concurrent posts). */
  async lockAccount(tx: TxContext, id: string): Promise<LockedAccount> {
    const r = await tx.query<any>(
      `SELECT id, cached_balance_minor, balance_version, last_entry_hash, is_frozen, owner_kind, account_code
         FROM wallet_accounts WHERE id=$1 FOR UPDATE`, [id]);
    const row = r.rows[0];
    return { id: row.id, balanceMinor: BigInt(row.cached_balance_minor), version: String(row.balance_version), lastHash: row.last_entry_hash, isFrozen: row.is_frozen, kind: row.owner_kind, accountCode: row.account_code };
  }

  /** Claim the idempotency key by inserting the txn header. Returns the existing id if replayed. */
  async insertTxnIdempotent(tx: TxContext, input: { txnTypeId: string; tenantId: string | null; idempotencyKey: string; referenceType?: string; referenceId?: string; initiatedBy?: string; description?: string }): Promise<{ id: string; replayed: boolean }> {
    // initiated_by is a uuid column; system-initiated money events (settlement, payout, dispute
    // handlers) pass the sentinel 'system' which is NOT a uuid. A system event has no user, so store
    // NULL — never a non-uuid string (else Postgres 22P02 rolls back the whole settlement silently).
    const initiatedBy = input.initiatedBy && UUID_RE.test(input.initiatedBy) ? input.initiatedBy : null;
    const ins = await tx.query<{ id: string }>(
      `INSERT INTO ledger_transactions (txn_type_id, tenant_id, reference_type, reference_id, description, idempotency_key, initiated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [input.txnTypeId, input.tenantId, input.referenceType ?? null, input.referenceId ?? null, input.description ?? null, input.idempotencyKey, initiatedBy]);
    if (ins.rows[0]) return { id: ins.rows[0].id, replayed: false };
    const prior = await tx.query<{ id: string }>(`SELECT id FROM ledger_transactions WHERE idempotency_key=$1`, [input.idempotencyKey]);
    return { id: prior.rows[0].id, replayed: true };
  }

  /** Append one balanced, hash-chained entry and update the account's cached balance. */
  async appendEntry(tx: TxContext, e: { txnId: string; accountId: string; tenantId: string | null; amountMinor: bigint; currencyCode: string; balanceAfter: bigint; prevHash: string | null; entryHash: string }): Promise<void> {
    await tx.query(
      `INSERT INTO ledger_entries (txn_id, account_id, tenant_id, amount_minor, currency_code, balance_after_minor, prev_hash, entry_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [e.txnId, e.accountId, e.tenantId, e.amountMinor.toString(), e.currencyCode, e.balanceAfter.toString(), e.prevHash, e.entryHash]);
    await tx.query(
      `UPDATE wallet_accounts SET cached_balance_minor=$2, balance_version=balance_version+1, last_entry_hash=$3, updated_at=now() WHERE id=$1`,
      [e.accountId, e.balanceAfter.toString(), e.entryHash]);
  }

  async balanceOf(tx: TxContext, id: string): Promise<bigint> {
    const r = await tx.query<{ cached_balance_minor: string }>(`SELECT cached_balance_minor FROM wallet_accounts WHERE id=$1`, [id]);
    return r.rows[0] ? BigInt(r.rows[0].cached_balance_minor) : 0n;
  }
}
