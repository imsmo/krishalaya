// apps/admin-api/src/modules/ledger-ops/repositories/ledger-ops.repository.ts · ALL SQL for W059/W064/W065.
//
// EVERY READ IS CROSS-TENANT (Law 11). The ledger is the platform's single money record and a per-tenant view of it
// cannot answer "does this balance". Stated at the top so the absence of `tenant_id = $1` reads as a decision.
//
// **EVERY MONEY COLUMN IS CAST `::text` AND PARSED TO bigint.** `pg` returns `bigint` as a string by default, which is
// the right default, and the explicit cast makes it impossible for a future config change to start handing these
// values over as JS numbers. There is no place in this file where a rupee figure is a `Number`.
//
// The recon repository's own header says it "NEVER touches ledger_entries/ledger_transactions" — that boundary was
// right for recon and is exactly what this module exists to cross, under its own permission.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import { parseMinor, type StripeRow } from '../domain/accounts';
import type { ChainEntry } from '../domain/hash-chain';

export interface TxnRow {
  id: string; txnTypeCode: string | null; tenantId: string | null;
  referenceType: string | null; referenceId: string | null; description: string | null;
  idempotencyKey: string | null; initiatedBy: string | null; createdAt: string;
  legCount: number | null; magnitudeMinor: bigint | null;
}

export interface EntryRow {
  id: string; txnId: string; accountId: string; tenantId: string | null;
  amountMinor: bigint; currencyCode: string; balanceAfterMinor: bigint;
  prevHash: string | null; entryHash: string; createdAt: string;
  accountCode: string | null; ownerKind: string | null; shardNo: number | null;
}

@Injectable()
export class LedgerOpsRepository {
  constructor(private readonly pool: AdminPool) {}

  /* ============================ W064 · the explorer ============================ */

  /** Keyset over (created_at, id) — the PARTITION KEY first, so Postgres prunes to the window's partitions (Law 8).
   *  `idx_ledger_txn_tenant_recent` / `idx_ledger_txn_type_recent` (0113) serve the filters; before them a filtered
   *  page was a scan of every partition.
   *
   *  MAGNITUDE, NOT SUM. W064's column is "Magnitude ₹48,600" and a transaction's legs sum to ZERO by construction, so
   *  a SUM column would read ₹0.00 on every healthy row. Half the sum of absolute leg amounts is the size of the
   *  movement — the figure an operator scanning the list is actually looking for. */
  async listTxns(q: {
    from: Date; to: Date; txnTypeCode?: string; tenantId?: string; accountCode?: string;
    cursor?: { c: string; id: string }; limit: number;
  }): Promise<TxnRow[]> {
    const p: unknown[] = [q.from, q.to];
    let w = 't.created_at >= $1 AND t.created_at <= $2';
    if (q.txnTypeCode) { p.push(q.txnTypeCode); w += ` AND lv.code = $${p.length}`; }
    if (q.tenantId) { p.push(q.tenantId); w += ` AND t.tenant_id = $${p.length}`; }
    if (q.accountCode) {
      p.push(q.accountCode);
      // EXISTS rather than a join: a transaction touching the same account_code twice must appear once, and a join
      // would duplicate the row and make the "Showing 1–25 of N" count wrong.
      w += ` AND EXISTS (SELECT 1 FROM ledger_entries le JOIN wallet_accounts wa ON wa.id = le.account_id
                          WHERE le.txn_id = t.id AND wa.account_code = $${p.length})`;
    }
    if (q.cursor) {
      p.push(q.cursor.c, q.cursor.id);
      w += ` AND (t.created_at < $${p.length - 1} OR (t.created_at = $${p.length - 1} AND t.id < $${p.length}))`;
    }
    p.push(q.limit);
    const r = await this.pool.query(
      `SELECT t.id, lv.code AS txn_type_code, t.tenant_id, t.reference_type, t.reference_id, t.description,
              t.idempotency_key, t.initiated_by, t.created_at,
              e.leg_count, e.magnitude::text AS magnitude
         FROM ledger_transactions t
         LEFT JOIN lookup_values lv ON lv.id = t.txn_type_id
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS leg_count, COALESCE(SUM(ABS(amount_minor)), 0) / 2 AS magnitude
             FROM ledger_entries le WHERE le.txn_id = t.id
         ) e ON true
        WHERE ${w} ORDER BY t.created_at DESC, t.id DESC LIMIT $${p.length}`, p);
    return r.rows.map(toTxn);
  }

  async getTxn(id: string): Promise<TxnRow | null> {
    const r = await this.pool.query(
      `SELECT t.id, lv.code AS txn_type_code, t.tenant_id, t.reference_type, t.reference_id, t.description,
              t.idempotency_key, t.initiated_by, t.created_at,
              NULL::int AS leg_count, NULL::text AS magnitude
         FROM ledger_transactions t LEFT JOIN lookup_values lv ON lv.id = t.txn_type_id
        WHERE t.id = $1`, [id]);
    return r.rows[0] ? toTxn(r.rows[0]) : null;
  }

  /** W065: "Search by idempotency key — retried operations share one txn." Already UNIQUE (0006), so this is the one
   *  lookup on this screen that cannot return two rows. */
  async getTxnByIdempotencyKey(key: string): Promise<TxnRow | null> {
    const r = await this.pool.query(
      `SELECT t.id, lv.code AS txn_type_code, t.tenant_id, t.reference_type, t.reference_id, t.description,
              t.idempotency_key, t.initiated_by, t.created_at,
              NULL::int AS leg_count, NULL::text AS magnitude
         FROM ledger_transactions t LEFT JOIN lookup_values lv ON lv.id = t.txn_type_id
        WHERE t.idempotency_key = $1`, [key]);
    return r.rows[0] ? toTxn(r.rows[0]) : null;
  }

  /** One transaction's legs, in the order they were written. `idx_ledger_txn (txn_id)` serves it. Ordered by id so
   *  W065's arithmetic line reads in the same order every time — a Σ that reshuffles between refreshes is one nobody
   *  will check by eye, which is the entire point of printing it. */
  async legsFor(txnId: string): Promise<EntryRow[]> {
    const r = await this.pool.query(
      `SELECT e.id::text AS id, e.txn_id, e.account_id, e.tenant_id, e.amount_minor::text AS amount_minor,
              e.currency_code, e.balance_after_minor::text AS balance_after_minor,
              e.prev_hash, e.entry_hash, e.created_at,
              a.account_code, a.owner_kind, a.shard_no
         FROM ledger_entries e LEFT JOIN wallet_accounts a ON a.id = e.account_id
        WHERE e.txn_id = $1 ORDER BY e.id ASC`, [txnId]);
    return r.rows.map(toEntry);
  }

  /* ============================ the chain walk ============================ */

  /** One account's entries, ASCENDING — a hash chain can only be walked forward from its oldest entry.
   *
   *  `idx_ledger_account (account_id, created_at DESC)` serves this backwards, which Postgres handles by scanning the
   *  index in reverse; that is fine and is why no ascending index was added. Bounded by `limit` because an account
   *  with a million entries must be verified in windows, and the caller records which window it walked.
   */
  async chainEntries(accountId: string, from: Date | null, to: Date, limit: number): Promise<ChainEntry[]> {
    const p: unknown[] = [accountId, to];
    let w = 'e.account_id = $1 AND e.created_at <= $2';
    if (from) { p.push(from); w += ` AND e.created_at >= $${p.length}`; }
    p.push(limit);
    const r = await this.pool.query(
      `SELECT e.id::text AS id, e.txn_id, e.account_id, e.amount_minor::text AS amount_minor,
              e.balance_after_minor::text AS balance_after_minor, e.prev_hash, e.entry_hash, e.created_at
         FROM ledger_entries e WHERE ${w} ORDER BY e.created_at ASC, e.id ASC LIMIT $${p.length}`, p);
    return r.rows.map((x: any) => ({
      id: x.id, txnId: x.txn_id, accountId: x.account_id,
      amountMinor: parseMinor(x.amount_minor, 'amount_minor'),
      balanceAfterMinor: parseMinor(x.balance_after_minor, 'balance_after_minor'),
      prevHash: x.prev_hash ?? null, entryHash: x.entry_hash,
      createdAt: new Date(x.created_at).toISOString(),
    }));
  }

  /** Whether the window's first entry is the account's genesis. Asked separately and cheaply, because the answer
   *  decides between `intact` and `incomplete` — and guessing it from "the window has no lower bound" would be wrong
   *  for an account whose first entry predates the retention horizon. */
  async isGenesisFirst(accountId: string, firstEntryId: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT NOT EXISTS (
         SELECT 1 FROM ledger_entries WHERE account_id = $1 AND id < $2::bigint
       ) AS is_first`, [accountId, firstEntryId]);
    return r.rows[0]?.is_first === true;
  }

  async recordVerification(c: PoolClient, v: {
    accountId: string; fromCreatedAt: Date | null; toCreatedAt: Date;
    entriesChecked: number; outcome: 'intact' | 'broken' | 'incomplete';
    brokenAtEntryId?: string | null; expectedHash?: string | null; storedHash?: string | null;
    headHash: string | null; verifiedBy: string | null;
  }): Promise<string> {
    const r = await c.query(
      `INSERT INTO ledger_chain_verifications
         (account_id, from_created_at, to_created_at, entries_checked, outcome,
          broken_at_entry_id, expected_hash, stored_hash, head_hash, verified_by)
       VALUES ($1,$2,$3,$4,$5,$6::bigint,$7,$8,$9,$10) RETURNING id`,
      [v.accountId, v.fromCreatedAt, v.toCreatedAt, v.entriesChecked, v.outcome,
        v.brokenAtEntryId ?? null, v.expectedHash ?? null, v.storedHash ?? null, v.headHash, v.verifiedBy]);
    return r.rows[0].id;
  }

  /** The newest verification for an account — what turns W006's and W059's bare "intact" into a claim with a date. */
  async latestVerification(accountId: string): Promise<{ outcome: string; createdAt: string; entriesChecked: number; brokenAtEntryId: string | null } | null> {
    const r = await this.pool.query(
      `SELECT outcome, created_at, entries_checked, broken_at_entry_id::text AS broken_at_entry_id
         FROM ledger_chain_verifications WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1`, [accountId]);
    const x = r.rows[0];
    return x ? {
      outcome: x.outcome, createdAt: new Date(x.created_at).toISOString(),
      entriesChecked: Number(x.entries_checked), brokenAtEntryId: x.broken_at_entry_id ?? null,
    } : null;
  }

  /** Any broken chain anywhere, newest first. Served by `idx_lcv_broken` (0113). This is the read W006's board needs
   *  to stop printing "hash chain intact" on faith. */
  async brokenVerifications(limit: number): Promise<{ id: string; accountId: string; createdAt: string; brokenAtEntryId: string | null }[]> {
    const r = await this.pool.query(
      `SELECT id, account_id, created_at, broken_at_entry_id::text AS broken_at_entry_id
         FROM ledger_chain_verifications WHERE outcome = 'broken' ORDER BY created_at DESC LIMIT $1`, [limit]);
    return r.rows.map((x: any) => ({
      id: x.id, accountId: x.account_id, createdAt: new Date(x.created_at).toISOString(),
      brokenAtEntryId: x.broken_at_entry_id ?? null,
    }));
  }

  /* ============================ W059 · accounts and their stripes ============================ */

  /** EVERY STRIPE of every platform account code. This is the read the console never had: `getAccount` returned ONE
   *  row by id, so a platform escrow balance was a fraction of the money and nothing said so. */
  async platformStripes(): Promise<StripeRow[]> {
    const r = await this.pool.query(
      `SELECT id, owner_kind, account_code, currency_code, shard_no,
              cached_balance_minor::text AS cached_balance_minor, balance_version::text AS balance_version,
              last_entry_hash, is_frozen, freeze_reason
         FROM wallet_accounts WHERE owner_kind = 'platform'
        ORDER BY account_code, currency_code, shard_no`);
    return r.rows.map(toStripe);
  }

  /** User and tenant accounts — always shard 0, so no summing. Keyset over (id) because there is no better stable
   *  order: `cached_balance_minor` moves constantly and paging by it would show rows twice. */
  async listOwnedAccounts(q: { ownerKind?: string; frozenOnly?: boolean; cursor?: string; limit: number }): Promise<StripeRow[]> {
    const p: unknown[] = [];
    let w = "owner_kind <> 'platform'";
    if (q.ownerKind) { p.push(q.ownerKind); w += ` AND owner_kind = $${p.length}`; }
    if (q.frozenOnly) w += ' AND is_frozen';
    if (q.cursor) { p.push(q.cursor); w += ` AND id > $${p.length}`; }
    p.push(q.limit);
    const r = await this.pool.query(
      `SELECT id, owner_kind, account_code, currency_code, shard_no,
              cached_balance_minor::text AS cached_balance_minor, balance_version::text AS balance_version,
              last_entry_hash, is_frozen, freeze_reason
         FROM wallet_accounts WHERE ${w} ORDER BY id ASC LIMIT $${p.length}`, p);
    return r.rows.map(toStripe);
  }

  async getAccount(id: string): Promise<StripeRow | null> {
    const r = await this.pool.query(
      `SELECT id, owner_kind, account_code, currency_code, shard_no,
              cached_balance_minor::text AS cached_balance_minor, balance_version::text AS balance_version,
              last_entry_hash, is_frozen, freeze_reason
         FROM wallet_accounts WHERE id = $1`, [id]);
    return r.rows[0] ? toStripe(r.rows[0]) : null;
  }

  /** THE PER-ACCOUNT DRIFT CHECK, on demand. W059's "Verify balances vs ledger" button.
   *
   *  The same comparison the scheduled `internal_balance` job makes, for ONE account, so an operator looking at a
   *  suspicious balance does not have to wait fifteen minutes for the sweep to reach it. Bounded to one account by the
   *  index, which is why this is safe on a table the sweep has to walk in pages. */
  async ledgerBalanceFor(accountId: string): Promise<bigint> {
    const r = await this.pool.query(
      `SELECT COALESCE(SUM(amount_minor), 0)::text AS s FROM ledger_entries WHERE account_id = $1`, [accountId]);
    return parseMinor(r.rows[0]?.s ?? '0', 'ledger balance');
  }

  /** The txn-type vocabulary, for W064's filter. DATA, not an enum — 0006's own comment says a new money product is
   *  an INSERT and never a code change, so a hardcoded list here would go stale the first time that happens. */
  async txnTypes(): Promise<{ code: string; name: string }[]> {
    const r = await this.pool.query(
      `SELECT code, default_name FROM lookup_values
        WHERE type_code = 'ledger_txn_type' AND tenant_id IS NULL AND deleted_at IS NULL
        ORDER BY sort_order, code`);
    return r.rows.map((x: any) => ({ code: x.code, name: x.default_name }));
  }
}

function toTxn(r: any): TxnRow {
  return {
    id: r.id, txnTypeCode: r.txn_type_code ?? null, tenantId: r.tenant_id ?? null,
    referenceType: r.reference_type ?? null, referenceId: r.reference_id ?? null,
    description: r.description ?? null, idempotencyKey: r.idempotency_key ?? null,
    initiatedBy: r.initiated_by ?? null, createdAt: new Date(r.created_at).toISOString(),
    legCount: r.leg_count === null || r.leg_count === undefined ? null : Number(r.leg_count),
    magnitudeMinor: r.magnitude === null || r.magnitude === undefined ? null : parseMinor(r.magnitude, 'magnitude'),
  };
}

function toEntry(r: any): EntryRow {
  return {
    id: r.id, txnId: r.txn_id, accountId: r.account_id, tenantId: r.tenant_id ?? null,
    amountMinor: parseMinor(r.amount_minor, 'amount_minor'), currencyCode: r.currency_code,
    balanceAfterMinor: parseMinor(r.balance_after_minor, 'balance_after_minor'),
    prevHash: r.prev_hash ?? null, entryHash: r.entry_hash,
    createdAt: new Date(r.created_at).toISOString(),
    accountCode: r.account_code ?? null, ownerKind: r.owner_kind ?? null,
    shardNo: r.shard_no === null || r.shard_no === undefined ? null : Number(r.shard_no),
  };
}

function toStripe(r: any): StripeRow {
  return {
    id: r.id, ownerKind: r.owner_kind, accountCode: r.account_code, currencyCode: r.currency_code,
    shardNo: Number(r.shard_no),
    cachedBalanceMinor: parseMinor(r.cached_balance_minor, 'cached_balance_minor'),
    balanceVersion: parseMinor(r.balance_version, 'balance_version'),
    lastEntryHash: r.last_entry_hash ?? null,
    isFrozen: r.is_frozen === true, freezeReason: r.freeze_reason ?? null,
  };
}
