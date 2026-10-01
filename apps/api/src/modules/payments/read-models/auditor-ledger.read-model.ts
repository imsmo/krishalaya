// modules/payments/read-models/auditor-ledger.read-model.ts · W200 + W436 + the `ledger.entries` export: THE AUDITOR'S
// LEDGER, THROUGH ONE FUNNEL (PC-56 TENANT-9c · F-10).
//
// THE ISOLATION FUNNEL — read this before adding a query to this file (TENANT-4a's doctrine, `org-wallet.read-model.ts`).
// wallet_accounts / ledger_transactions / ledger_entries carry NO row-level policies, deliberately (0014: "history is
// physics, not policy"). On the read side, tenant isolation is a property of these queries and of nothing else. So:
//   1. EVERY query here takes `tenantId` — the tenancy context's value from the JWT — and NOTHING a caller sent selects an
//      account: no account id, no account code, no owner id, no "viewAs" is a parameter of any method.
//   2. A TRANSACTION is the tenant's when `ledger_transactions.tenant_id = $1`; a LEG is shown when `ledger_entries.tenant_id
//      = $1` (the tenant of the money event the leg belongs to). Both, always. A leg on an account another tenant OWNS is
//      never printed (it is counted, `other_tenant`, and its amount withheld).
//   3. THE ACCOUNT → TENANT MAP decides what a leg may say: on an account the tenant owns (`owner_kind='tenant' AND
//      owner_tenant_id = $1`) — amount, balance after, prev/entry hash and the hash link (recomputed); on a PLATFORM account
//      (escrow, fees … shared by every tenant, striped — ADMIN-6) — the amount only: the balance after it is the platform's
//      balance across tenants and its predecessor is likely another tenant's entry, so the link is WITHHELD BY NAME
//      (`shared_stripe`). The funnel REFUSES to answer for a shared account: there is no method here that reads a platform
//      account's chain, balance or predecessor, and none may be added.
//   4. The predecessor lookup (the entry before a leg on the same account) runs ONLY for a tenant-own account, guarded in SQL.
//   5. `auditor-ledger.spec.ts` pins 1–4 by reading this file's own SQL.
// Served from the replica (Law 12) under the tenant's context. Money is bigint minor units as strings. Read-only: kv_app
// holds SELECT and nothing else on the ledger. Windows are civil days in the cooperative's zone; partition-key bounds on
// every `ledger_entries` read (Law 8). Keyset on (created_at, id) with the µs cursor (9a's F-7 fix).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { verifyChain, headMatches, type ChainEntry, type ChainVerdict } from '../../../core/wallet/hash-chain';
import { decodeKeyset, encodeKeyset, UUID_RE, US_SQL } from '../../../shared/pagination/us-keyset';
import { footOf, viewLegs, balanceEqualsSum, type LegView, type RawLeg, type TxnFoot } from '../domain/auditor-ledger';

export interface AuditorWindow { fromDay: string; toDay: string; zone: string }

export interface AuditorTxnView {
  txnId: string; createdAt: string; txnType: string | null; referenceType: string | null; referenceId: string | null;
  description: string | null; currencyCode: string | null; legs: LegView[]; foot: TxnFoot;
}
export interface AuditorLedgerPage { items: AuditorTxnView[]; nextCursor: string | null }

export interface OwnAccountTruth {
  accountCode: string; currencyCode: string; entryCount: number; cachedMinor: string; ledgerSumMinor: string;
  balance: { equal: boolean; driftMinor: string };
  chain: ChainVerdict; headMatches: boolean | null;
}

/** The cap on one account's on-demand walk. Over it the verdict is `incomplete`, never `intact` (TENANT-4a's rule). */
export const OWN_CHAIN_WALK_CAP = 5_000;

const ENTRY_PRUNE = `e.created_at >= (($2::date) - 1)::timestamp AT TIME ZONE $4 AND e.created_at < (($3::date) + 2)::timestamp AT TIME ZONE $4`;

@Injectable()
export class AuditorLedgerReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** W436 / W200's explorer: the tenant's transactions in the window, newest first, each with ALL its tenant-attributed legs. */
  async page(tenantId: string, win: AuditorWindow, opts: { cursor?: string; limit?: number; txnType?: string } = {}): Promise<AuditorLedgerPage> {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
    const cur = decodeKeyset(opts.cursor, UUID_RE);
    const params: unknown[] = [tenantId, win.fromDay, win.toDay, win.zone];
    const conds: string[] = [];
    if (opts.txnType) { params.push(opts.txnType); conds.push(`lv.code = $${params.length}`); }
    if (cur) {
      params.push(cur.ts, cur.id);
      conds.push(`(t.created_at < $${params.length - 1}::timestamptz OR (t.created_at = $${params.length - 1}::timestamptz AND t.id < $${params.length}::uuid))`);
    }
    const tx = await this.replica.forTenant(tenantId).query<any>( // eslint-disable-line @typescript-eslint/no-explicit-any
      `SELECT t.id::text AS txn_id, t.created_at, ${US_SQL('t.created_at')} AS cursor_ts, lv.code AS txn_type,
              t.reference_type, t.reference_id::text AS reference_id, t.description,
              (SELECT count(*) FROM ledger_entries x
                WHERE x.txn_id = t.id AND x.created_at >= (($2::date) - 1)::timestamp AT TIME ZONE $4
                  AND x.created_at < (($3::date) + 2)::timestamp AT TIME ZONE $4)::int AS legs_total
         FROM ledger_transactions t
         LEFT JOIN lookup_values lv ON lv.id = t.txn_type_id
        WHERE t.tenant_id = $1
          AND t.created_at >= ($2::date)::timestamp AT TIME ZONE $4 AND t.created_at < (($3::date) + 1)::timestamp AT TIME ZONE $4
          ${conds.length ? `AND ${conds.join(' AND ')}` : ''}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT ${limit + 1}`,
      params);
    const rows = tx.rows.slice(0, limit);
    const legs = await this.legsOf(tenantId, win, rows.map((r: any) => r.txn_id)); // eslint-disable-line @typescript-eslint/no-explicit-any
    const items = rows.map((r: any) => this.txnView(tenantId, r, legs.get(r.txn_id) ?? [])); // eslint-disable-line @typescript-eslint/no-explicit-any
    const last = rows[rows.length - 1];
    return { items, nextCursor: tx.rows.length > limit && last ? encodeKeyset(last.cursor_ts, last.txn_id) : null };
  }

  /** The legs of the given transactions that carry THIS tenant's id. The predecessor (for the hash link) is read only for
   *  an account the tenant owns — the CASE guard is in SQL, not in code that could forget it. */
  private async legsOf(tenantId: string, win: AuditorWindow, txnIds: string[]): Promise<Map<string, RawLeg[]>> {
    const out = new Map<string, RawLeg[]>();
    if (txnIds.length === 0) return out;
    const r = await this.replica.forTenant(tenantId).query<any>( // eslint-disable-line @typescript-eslint/no-explicit-any
      `SELECT e.id::text AS entry_id, e.txn_id::text AS txn_id, e.account_id::text AS account_id, a.account_code,
              a.owner_kind::text AS owner_kind, a.owner_tenant_id::text AS owner_tenant_id, a.owner_user_id::text AS owner_user_id,
              e.amount_minor::text AS amount_minor, e.currency_code, e.balance_after_minor::text AS balance_after_minor,
              e.prev_hash, e.entry_hash, e.created_at,
              CASE WHEN a.owner_kind = 'tenant' AND a.owner_tenant_id = $1 THEN (
                SELECT p.entry_hash FROM ledger_entries p
                 WHERE p.account_id = e.account_id AND p.id < e.id
                 ORDER BY p.id DESC LIMIT 1) END AS predecessor_hash
         FROM ledger_entries e
         JOIN wallet_accounts a ON a.id = e.account_id
        WHERE e.tenant_id = $1 AND e.txn_id = ANY($5::uuid[]) AND ${ENTRY_PRUNE}
        ORDER BY e.txn_id, e.id`,
      [tenantId, win.fromDay, win.toDay, win.zone, txnIds]);
    for (const x of r.rows) {
      const leg: RawLeg = {
        entryId: x.entry_id, txnId: x.txn_id, accountId: x.account_id, accountCode: x.account_code, ownerKind: x.owner_kind,
        ownerTenantId: x.owner_tenant_id ?? null, ownerUserId: x.owner_user_id ?? null, amountMinor: x.amount_minor,
        currencyCode: String(x.currency_code).trim(), balanceAfterMinor: x.balance_after_minor, prevHash: x.prev_hash ?? null,
        entryHash: x.entry_hash, createdAt: x.created_at instanceof Date ? x.created_at.toISOString() : String(x.created_at),
        predecessorHash: x.predecessor_hash ?? null,
      };
      const list = out.get(leg.txnId) ?? [];
      list.push(leg);
      out.set(leg.txnId, list);
    }
    return out;
  }

  private txnView(tenantId: string, r: any, raw: RawLeg[]): AuditorTxnView { // eslint-disable-line @typescript-eslint/no-explicit-any
    const legs = viewLegs(raw, tenantId);
    // A leg on another tenant's account is never printed: its amount is not part of what this tenant may foot, and the
    // transaction then reads incomplete (visible < total) instead of footing a part.
    const shown = legs.filter((l) => l.kind !== 'other_tenant');
    return {
      txnId: r.txn_id, createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      txnType: r.txn_type ?? null, referenceType: r.reference_type ?? null, referenceId: r.reference_id ?? null,
      description: r.description ?? null, currencyCode: raw[0]?.currencyCode ?? null,
      legs: shown, foot: footOf(shown.map((l) => l.amountMinor), Number(r.legs_total ?? 0)),
    };
  }

  /** W200's "Transactions in the period" — a COUNT of the tenant's transactions in the window. */
  async txnCount(tenantId: string, win: AuditorWindow): Promise<number> {
    const r = await this.replica.forTenant(tenantId).query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ledger_transactions t
        WHERE t.tenant_id = $1 AND t.created_at >= ($2::date)::timestamp AT TIME ZONE $4 AND t.created_at < (($3::date) + 1)::timestamp AT TIME ZONE $4`,
      [tenantId, win.fromDay, win.toDay, win.zone]);
    return Number(r.rows[0]?.n ?? 0);
  }

  /** W200's zero-sum invariant over the WHOLE window (not just a page): how many of the tenant's transactions foot, how many
   *  do not, and how many the tenant cannot see whole. Computed in SQL over the tenant's own legs. */
  async zeroSum(tenantId: string, win: AuditorWindow): Promise<{ checked: number; foot: number; notFoot: number; incomplete: number }> {
    const r = await this.replica.forTenant(tenantId).query<{ checked: string; foot: string; not_foot: string; incomplete: string }>(
      `WITH txn AS (
         SELECT t.id FROM ledger_transactions t
          WHERE t.tenant_id = $1 AND t.created_at >= ($2::date)::timestamp AT TIME ZONE $4 AND t.created_at < (($3::date) + 1)::timestamp AT TIME ZONE $4
       ), legs AS (
         SELECT e.txn_id, count(*) FILTER (WHERE e.tenant_id = $1) AS visible, count(*) AS total,
                COALESCE(SUM(e.amount_minor) FILTER (WHERE e.tenant_id = $1), 0) AS s
           FROM ledger_entries e JOIN txn ON txn.id = e.txn_id
          WHERE ${ENTRY_PRUNE}
          GROUP BY e.txn_id
       )
       SELECT count(*)::text AS checked,
              count(*) FILTER (WHERE l.visible = l.total AND l.total > 1 AND l.s = 0)::text AS foot,
              count(*) FILTER (WHERE l.visible = l.total AND l.total > 1 AND l.s <> 0)::text AS not_foot,
              count(*) FILTER (WHERE l.txn_id IS NULL OR l.visible <> l.total OR l.total <= 1)::text AS incomplete
         FROM txn LEFT JOIN legs l ON l.txn_id = txn.id`,
      [tenantId, win.fromDay, win.toDay, win.zone]);
    const x = r.rows[0];
    return { checked: Number(x?.checked ?? 0), foot: Number(x?.foot ?? 0), notFoot: Number(x?.not_foot ?? 0), incomplete: Number(x?.incomplete ?? 0) };
  }

  /** Balance = Σ and the hash chain, for each account the TENANT OWNS — walked from genesis with the writer's own formula,
   *  capped (over the cap: `incomplete`), with the head pointer compared (the truncation check). Platform accounts are not
   *  walked here, by construction: a shared stripe is not one tenant's chain (ADMIN-6). */
  async ownAccounts(tenantId: string, currencyCode: string): Promise<OwnAccountTruth[]> {
    const accts = await this.replica.forTenant(tenantId).query<any>( // eslint-disable-line @typescript-eslint/no-explicit-any
      `SELECT a.id::text AS id, a.account_code, a.currency_code, a.cached_balance_minor::text AS cached_minor, a.last_entry_hash,
              COALESCE((SELECT SUM(e.amount_minor) FROM ledger_entries e WHERE e.account_id = a.id), 0)::text AS ledger_sum,
              (SELECT count(*) FROM ledger_entries e WHERE e.account_id = a.id)::int AS n
         FROM wallet_accounts a
        WHERE a.owner_kind = 'tenant' AND a.owner_tenant_id = $1 AND a.currency_code = $2 AND a.deleted_at IS NULL
        ORDER BY a.account_code`,
      [tenantId, currencyCode]);
    const out: OwnAccountTruth[] = [];
    for (const a of accts.rows) {
      const walk = await this.walkOwn(tenantId, a.id);
      out.push({
        accountCode: a.account_code, currencyCode: String(a.currency_code).trim(), entryCount: Number(a.n),
        cachedMinor: a.cached_minor, ledgerSumMinor: a.ledger_sum, balance: balanceEqualsSum(a.cached_minor, a.ledger_sum),
        chain: walk, headMatches: headMatches(walk, a.last_entry_hash ?? null),
      });
    }
    return out;
  }

  /** The walk itself — private, and its account id comes ONLY from `ownAccounts`' tenant-owned rows (re-checked in SQL). */
  private async walkOwn(tenantId: string, accountId: string): Promise<ChainVerdict> {
    const r = await this.replica.forTenant(tenantId).query<any>( // eslint-disable-line @typescript-eslint/no-explicit-any
      `SELECT e.id::text AS id, e.txn_id::text AS txn_id, e.account_id::text AS account_id, e.amount_minor::text AS amount_minor,
              e.balance_after_minor::text AS balance_after_minor, e.prev_hash, e.entry_hash, e.created_at
         FROM ledger_entries e
         JOIN wallet_accounts a ON a.id = e.account_id AND a.owner_kind = 'tenant' AND a.owner_tenant_id = $1
        WHERE e.account_id = $2
        ORDER BY e.id ASC
        LIMIT ${OWN_CHAIN_WALK_CAP + 1}`,
      [tenantId, accountId]);
    if (r.rows.length > OWN_CHAIN_WALK_CAP) return { kind: 'incomplete', checked: 0, reason: 'window_opened_mid_chain' };
    const entries: ChainEntry[] = r.rows.map((x: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      id: x.id, txnId: x.txn_id, accountId: x.account_id, amountMinor: x.amount_minor, balanceAfterMinor: x.balance_after_minor,
      prevHash: x.prev_hash ?? null, entryHash: x.entry_hash, createdAt: x.created_at instanceof Date ? x.created_at.toISOString() : String(x.created_at),
    }));
    return verifyChain(entries);
  }

  /** The `ledger.entries` export: every tenant-attributed leg of every tenant transaction in the window, oldest first, in
   *  pages through the SAME funnel (`page` reads newest first; the export walks forward so a file reads like a book). */
  async *exportLegs(tenantId: string, win: AuditorWindow, cap: number): AsyncGenerator<{ txn: AuditorTxnView; leg: LegView } | { truncated: true }> {
    let cursor: { ts: string; id: string } | null = null;
    let emitted = 0;
    for (;;) {
      const params: unknown[] = [tenantId, win.fromDay, win.toDay, win.zone];
      let cond = '';
      if (cursor) { params.push(cursor.ts, cursor.id); cond = `AND (t.created_at > $5::timestamptz OR (t.created_at = $5::timestamptz AND t.id > $6::uuid))`; }
      const tx = await this.replica.forTenant(tenantId).query<any>( // eslint-disable-line @typescript-eslint/no-explicit-any
        `SELECT t.id::text AS txn_id, t.created_at, ${US_SQL('t.created_at')} AS cursor_ts, lv.code AS txn_type,
                t.reference_type, t.reference_id::text AS reference_id, t.description,
                (SELECT count(*) FROM ledger_entries x
                  WHERE x.txn_id = t.id AND x.created_at >= (($2::date) - 1)::timestamp AT TIME ZONE $4
                    AND x.created_at < (($3::date) + 2)::timestamp AT TIME ZONE $4)::int AS legs_total
           FROM ledger_transactions t
           LEFT JOIN lookup_values lv ON lv.id = t.txn_type_id
          WHERE t.tenant_id = $1
            AND t.created_at >= ($2::date)::timestamp AT TIME ZONE $4 AND t.created_at < (($3::date) + 1)::timestamp AT TIME ZONE $4
            ${cond}
          ORDER BY t.created_at ASC, t.id ASC
          LIMIT 200`,
        params);
      if (tx.rows.length === 0) return;
      const legs = await this.legsOf(tenantId, win, tx.rows.map((r: any) => r.txn_id)); // eslint-disable-line @typescript-eslint/no-explicit-any
      for (const r of tx.rows) {
        const view = this.txnView(tenantId, r, legs.get(r.txn_id) ?? []);
        for (const leg of view.legs) {
          if (emitted >= cap) { yield { truncated: true }; return; }
          emitted += 1;
          yield { txn: view, leg };
        }
      }
      const last = tx.rows[tx.rows.length - 1];
      cursor = { ts: last.cursor_ts, id: last.txn_id };
      if (tx.rows.length < 200) return;
    }
  }
}
