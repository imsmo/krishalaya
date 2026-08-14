// modules/payments/read-models/org-wallet.read-model.ts · W143 + W144: THE TENANT'S OWN WALLET
// (PC-56 TENANT-4a). The first code anywhere on this platform that reads a tenant-owned wallet account.
//
// THE ISOLATION FUNNEL — read this before adding a query to this file.
// wallet_accounts / ledger_transactions / ledger_entries carry NO row-level policies, deliberately
// (0014's "history is physics, not policy": the ledger is the wallet service's book and kv_app holds
// SELECT and nothing else — 0077 revoked every write and made entries append-only by trigger). So on
// the READ side, tenant isolation is a property of these queries and of nothing else. Therefore:
//
//   1. EVERY query in this file resolves accounts from `tenantId` — the value the tenancy context
//      derived from the JWT — and from NOTHING the caller sent. No account id, no account code, no
//      owner id, and no "viewAs" is accepted as an argument anywhere in this class.
//   2. The escrow query is the one that touches a PLATFORM account (shared by every tenant), and it
//      filters on `e.tenant_id = $1`, which is the tenant of the money-event the leg belongs to.
//   3. The spec pins 1 and 2 by reading this file's own SQL: a query that filtered on anything else
//      fails a test rather than shipping a cross-tenant read of a ledger with no RLS behind it.
//
// Served from the replica (Law 12). Money is bigint minor units as strings, always. Read-only: this
// class never writes the ledger (Law 2/11) and cannot — its role has no grant to.
import { Injectable } from '@nestjs/common';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { verifyChain, headMatches, type ChainEntry, type ChainVerdict } from '../../../core/wallet/hash-chain';
import {
  TENANT_ACCOUNT_CODES, type TenantAccountCode, type AccountTruth,
  balanceVerdict, holdBasis, healthLines, escrowView, resolveLedgerWindow,
  type BalanceVerdict, type HealthLine, type EscrowView, type LedgerWindow,
} from '../domain/org-wallet';

export interface OrgAccountView {
  code: TenantAccountCode;
  verdict: BalanceVerdict;
  minor: string;              // ALWAYS the ledger's own sum (see balanceVerdict — never the cache)
  isFrozen: boolean;
  entryCount: number;
  lastEntryAt: string | null;
}

export interface OrgMovementView {
  entryId: string; txnId: string; txnType: string | null; accountCode: string;
  amountMinor: string; currencyCode: string;
  referenceType: string | null; referenceId: string | null; description: string | null; createdAt: string;
}

export interface OrgWalletOverview {
  currencyCode: string;
  accounts: OrgAccountView[];
  holdBasis: ReturnType<typeof holdBasis>;
  escrow: EscrowView;
  today: OrgMovementView[];
  health: HealthLine[];
  chain: { accountCode: TenantAccountCode; verdict: ChainVerdict; headMatches: boolean | null } | null;
}

export interface OrgLedgerRow extends OrgMovementView { balanceAfterMinor: string }
export interface OrgLedgerPage { items: OrgLedgerRow[]; nextCursor: string | null; window: LedgerWindow }

export const encodeOrgLedgerCursor = (createdAtIso: string, entryId: string): string =>
  Buffer.from(`${createdAtIso}|${entryId}`).toString('base64');

const CCY = /^[A-Z]{3}$/;

@Injectable()
export class OrgWalletReadModel {
  constructor(private readonly pools: PgPoolProvider) {}

  /** THE FUNNEL. The tenant's own three account rows — id, cached balance, ledger sum, chain head.
   *  An account that has never been used has no row; that absence is carried through as `exists:false`
   *  rather than becoming a zero indistinguishable from a used-and-empty account. */
  private async accountTruth(tenantId: string, currencyCode: string): Promise<Array<AccountTruth & { id: string; entryCount: number; lastEntryAt: string | null }>> {
    const r = await this.pools.replica(0).query<{
      id: string; account_code: string; cached_balance_minor: string; is_frozen: boolean;
      last_entry_hash: string | null; ledger_sum_minor: string; entry_count: string; last_entry_at: Date | null;
    }>(
      `SELECT a.id::text AS id, a.account_code, a.cached_balance_minor::text AS cached_balance_minor,
              a.is_frozen, a.last_entry_hash,
              COALESCE(SUM(e.amount_minor), 0)::text AS ledger_sum_minor,
              count(e.id)::text AS entry_count, max(e.created_at) AS last_entry_at
         FROM wallet_accounts a
         LEFT JOIN ledger_entries e ON e.account_id = a.id
        WHERE a.owner_kind = 'tenant' AND a.owner_tenant_id = $1 AND a.currency_code = $2
        GROUP BY a.id, a.account_code, a.cached_balance_minor, a.is_frozen, a.last_entry_hash`,
      [tenantId, currencyCode]);
    return r.rows.map((x) => ({
      code: x.account_code as TenantAccountCode,
      exists: true,
      cachedMinor: x.cached_balance_minor,
      ledgerSumMinor: x.ledger_sum_minor,
      isFrozen: x.is_frozen,
      lastEntryHash: x.last_entry_hash,
      id: x.id,
      entryCount: Number(x.entry_count),
      lastEntryAt: x.last_entry_at ? x.last_entry_at.toISOString() : null,
    }));
  }

  /** W143 whole. Every read degrades on its own (Law 12): a failed chain walk leaves the balances
   *  standing and reports the chain as unverifiable, because "we could not check" and "intact" are
   *  different sentences and only one of them is true. */
  async overview(tenantId: string, opts: { currencyCode?: string; now?: Date } = {}): Promise<OrgWalletOverview> {
    const currencyCode = opts.currencyCode && CCY.test(opts.currencyCode) ? opts.currencyCode : 'INR';
    const now = opts.now ?? new Date();
    const present = await this.accountTruth(tenantId, currencyCode);

    const accounts: OrgAccountView[] = TENANT_ACCOUNT_CODES.map((code) => {
      const row = present.find((p) => p.code === code);
      const truth: AccountTruth = row ?? { code, exists: false, cachedMinor: '0', ledgerSumMinor: '0', isFrozen: false, lastEntryHash: null };
      const verdict = balanceVerdict(truth);
      return {
        code,
        verdict,
        minor: verdict.kind === 'never_used' ? '0' : verdict.minor,
        isFrozen: truth.isFrozen,
        entryCount: row?.entryCount ?? 0,
        lastEntryAt: row?.lastEntryAt ?? null,
      };
    });

    const hold = accounts.find((a) => a.code === 'hold');
    const mainRow = present.find((p) => p.code === 'main') ?? present[0];

    const [escrowRes, todayRes, chainRes] = await Promise.allSettled([
      this.escrow(tenantId, currencyCode),
      this.movementsSince(tenantId, currencyCode, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))),
      mainRow ? this.chainOf(mainRow.id, mainRow.lastEntryHash) : Promise.resolve(null),
    ]);

    const chain = chainRes.status === 'fulfilled' && chainRes.value && mainRow
      ? { accountCode: mainRow.code, verdict: chainRes.value.verdict, headMatches: chainRes.value.headMatches }
      : null;

    return {
      currencyCode,
      accounts,
      holdBasis: holdBasis(hold?.minor ?? '0'),
      escrow: escrowRes.status === 'fulfilled' ? escrowRes.value : escrowView('0', 0),
      today: todayRes.status === 'fulfilled' ? todayRes.value : [],
      health: healthLines(
        present.length ? present : TENANT_ACCOUNT_CODES.map((code) => ({ code, exists: false, cachedMinor: '0', ledgerSumMinor: '0', isFrozen: false, lastEntryHash: null })),
        chain?.verdict ?? null,
        chain?.headMatches ?? null,
      ),
      chain,
    };
  }

  /** W143's escrow card. The PLATFORM escrow account, restricted to legs carrying THIS tenant's id —
   *  the only query in this file that reads an account the tenant does not own, and the reason 0142
   *  adds (tenant_id, account_id, created_at) to a table whose hottest account is this one. */
  private async escrow(tenantId: string, currencyCode: string): Promise<EscrowView> {
    const r = await this.pools.replica(0).query<{ net_minor: string; order_count: string }>(
      `SELECT COALESCE(SUM(e.amount_minor), 0)::text AS net_minor,
              count(DISTINCT t.reference_id)::text AS order_count
         FROM ledger_entries e
         JOIN wallet_accounts a ON a.id = e.account_id AND a.owner_kind = 'platform' AND a.account_code = 'escrow'
         JOIN ledger_transactions t ON t.id = e.txn_id
        WHERE e.tenant_id = $1 AND e.currency_code = $2`,
      [tenantId, currencyCode]);
    return escrowView(r.rows[0]?.net_minor ?? '0', Number(r.rows[0]?.order_count ?? 0));
  }

  /** W143's "Today's movement". Bounded to the calendar day, newest first, capped — a feed on a money
   *  screen that silently truncated would be the same defect as a page-numbered ledger. */
  private async movementsSince(tenantId: string, currencyCode: string, since: Date, limit = 20): Promise<OrgMovementView[]> {
    const r = await this.pools.replica(0).query<any>(
      `SELECT e.id::text AS entry_id, e.txn_id::text AS txn_id, lv.code AS txn_type, a.account_code,
              e.amount_minor::text AS amount_minor, e.currency_code,
              t.reference_type, t.reference_id::text AS reference_id, t.description, e.created_at
         FROM ledger_entries e
         JOIN wallet_accounts a
           ON a.id = e.account_id AND a.owner_kind = 'tenant' AND a.owner_tenant_id = $1
         JOIN ledger_transactions t ON t.id = e.txn_id
         LEFT JOIN lookup_values lv ON lv.id = t.txn_type_id
        WHERE e.currency_code = $2 AND e.created_at >= $3
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT ${limit}`,
      [tenantId, currencyCode, since.toISOString()]);
    return r.rows.map(this.toMovement);
  }

  /** Walk one of the tenant's OWN accounts with the writer's own hash function. Oldest first from the
   *  account's genesis, so the walk is anchored; capped, and a cap makes the verdict `incomplete`
   *  rather than `intact` over a prefix — an unfinished check must not print as a passed one. */
  private async chainOf(accountId: string, accountLastHash: string | null, limit = 5_000): Promise<{ verdict: ChainVerdict; headMatches: boolean | null }> {
    const r = await this.pools.replica(0).query<any>(
      `SELECT e.id::text AS id, e.txn_id::text AS txn_id, e.account_id::text AS account_id,
              e.amount_minor::text AS amount_minor, e.balance_after_minor::text AS balance_after_minor,
              e.prev_hash, e.entry_hash, e.created_at
         FROM ledger_entries e
        WHERE e.account_id = $1
        ORDER BY e.created_at ASC, e.id ASC
        LIMIT ${limit + 1}`,
      [accountId]);
    if (r.rows.length > limit) {
      return { verdict: { kind: 'incomplete', checked: 0, reason: 'window_opened_mid_chain' }, headMatches: null };
    }
    const entries: ChainEntry[] = r.rows.map((x: any) => ({
      id: x.id, txnId: x.txn_id, accountId: x.account_id, amountMinor: x.amount_minor,
      balanceAfterMinor: x.balance_after_minor, prevHash: x.prev_hash ?? null, entryHash: x.entry_hash,
      createdAt: x.created_at.toISOString(),
    }));
    const verdict = verifyChain(entries);
    return { verdict, headMatches: headMatches(verdict, accountLastHash) };
  }

  /** W144. Keyset only — (created_at DESC, id DESC), never OFFSET and never a page number. The account
   *  filter is validated against TENANT_ACCOUNT_CODES by the caller's DTO; even so this query joins on
   *  the tenant's own accounts first, so an unknown code narrows a set that is already the tenant's. */
  async ledger(
    tenantId: string,
    opts: { cursor?: { c: string; id: string }; limit?: number; accountCode?: TenantAccountCode; txnType?: string; from?: string; to?: string; currencyCode?: string; now?: Date },
  ): Promise<OrgLedgerPage> {
    const currencyCode = opts.currencyCode && CCY.test(opts.currencyCode) ? opts.currencyCode : 'INR';
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    const win = resolveLedgerWindow(opts.from, opts.to, opts.now ?? new Date());
    const params: unknown[] = [tenantId, currencyCode, win.fromIso, win.toIso];
    const conds: string[] = [];
    if (opts.accountCode) { params.push(opts.accountCode); conds.push(`a.account_code = $${params.length}`); }
    if (opts.txnType) { params.push(opts.txnType); conds.push(`lv.code = $${params.length}`); }
    if (opts.cursor) {
      params.push(opts.cursor.c, opts.cursor.id);
      conds.push(`(e.created_at < $${params.length - 1} OR (e.created_at = $${params.length - 1} AND e.id < $${params.length}::bigint))`);
    }
    const r = await this.pools.replica(0).query<any>(
      `SELECT e.id::text AS entry_id, e.txn_id::text AS txn_id, lv.code AS txn_type, a.account_code,
              e.amount_minor::text AS amount_minor, e.balance_after_minor::text AS balance_after_minor,
              e.currency_code, t.reference_type, t.reference_id::text AS reference_id, t.description, e.created_at
         FROM ledger_entries e
         JOIN wallet_accounts a
           ON a.id = e.account_id AND a.owner_kind = 'tenant' AND a.owner_tenant_id = $1
         JOIN ledger_transactions t ON t.id = e.txn_id
         LEFT JOIN lookup_values lv ON lv.id = t.txn_type_id
        WHERE e.currency_code = $2 AND e.created_at >= $3 AND e.created_at <= $4
              ${conds.length ? `AND ${conds.join(' AND ')}` : ''}
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT ${limit + 1}`,
      params);
    const rows = r.rows.slice(0, limit);
    const nextCursor = r.rows.length > limit
      ? encodeOrgLedgerCursor(rows[rows.length - 1].created_at.toISOString(), rows[rows.length - 1].entry_id)
      : null;
    return {
      items: rows.map((x: any) => ({ ...this.toMovement(x), balanceAfterMinor: x.balance_after_minor })),
      nextCursor,
      window: win,
    };
  }

  /** Every row of the window for the CSV export — the same funnel, walked by cursor rather than by a
   *  second query, so the export cannot disagree with the screen. If the window holds more rows than
   *  the cap, the export SAYS SO (`truncated`) and the receipt carries the count: a money export that
   *  quietly stopped at a round number would be read as a complete statement. */
  async exportRows(
    tenantId: string,
    opts: { from?: string; to?: string; accountCode?: TenantAccountCode; txnType?: string; currencyCode?: string; now?: Date; cap: number },
  ): Promise<{ rows: OrgLedgerRow[]; truncated: boolean; window: LedgerWindow }> {
    const rows: OrgLedgerRow[] = [];
    let cursor: { c: string; id: string } | undefined;
    let window: LedgerWindow | null = null;
    for (;;) {
      const page = await this.ledger(tenantId, { ...opts, cursor, limit: 100 });
      window = page.window;
      for (const row of page.items) {
        if (rows.length >= opts.cap) return { rows, truncated: true, window };
        rows.push(row);
      }
      if (!page.nextCursor) return { rows, truncated: false, window };
      const [c, id] = Buffer.from(page.nextCursor, 'base64').toString().split('|');
      cursor = { c, id };
    }
  }

  /** The txn types actually PRESENT in this tenant's own ledger — W144's filter chips. Lookup data, as
   *  Law 6 requires, and drawn from the rows rather than from a hardcoded list, so a new money product
   *  appears in the filter without an app change (which is exactly what W144 claims). */
  async txnTypesPresent(tenantId: string, currencyCode = 'INR'): Promise<Array<{ code: string; count: number }>> {
    const r = await this.pools.replica(0).query<{ code: string | null; n: string }>(
      `SELECT lv.code, count(*)::text AS n
         FROM ledger_entries e
         JOIN wallet_accounts a
           ON a.id = e.account_id AND a.owner_kind = 'tenant' AND a.owner_tenant_id = $1
         JOIN ledger_transactions t ON t.id = e.txn_id
         LEFT JOIN lookup_values lv ON lv.id = t.txn_type_id
        WHERE e.currency_code = $2
        GROUP BY lv.code ORDER BY count(*) DESC, lv.code ASC LIMIT 40`,
      [tenantId, currencyCode]);
    return r.rows.filter((x) => !!x.code).map((x) => ({ code: x.code as string, count: Number(x.n) }));
  }

  private toMovement = (x: any): OrgMovementView => ({
    entryId: x.entry_id, txnId: x.txn_id, txnType: x.txn_type ?? null, accountCode: x.account_code,
    amountMinor: x.amount_minor, currencyCode: x.currency_code,
    referenceType: x.reference_type ?? null, referenceId: x.reference_id ?? null,
    description: x.description ?? null, createdAt: x.created_at.toISOString(),
  });
}
