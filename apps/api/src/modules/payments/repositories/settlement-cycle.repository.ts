// modules/payments/repositories/settlement-cycle.repository.ts · the cycle plane's SQL (PC-56 TENANT-4c).
// Every statement is tenant-scoped in its predicate as well as by 0144's RLS — two independent gates, and
// the query is written as though the policy did not exist. Writes run inside the caller's tenant-scoped
// UnitOfWork; reads for the console go to the replica (CQRS, Law 12).
import { Injectable } from '@nestjs/common';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import type { CycleStatus } from '../domain/settlement-cycle';

export interface CycleRow {
  id: string; tenantId: string; periodStart: string; periodEnd: string; status: CycleStatus;
  requestedBy: string | null; requestedAt: Date | null;
  decidedBy: string | null; decidedAt: Date | null; decisionNote: string | null;
  sellersExpected: number | null; statementsGenerated: number;
  grossMinor: string; netMinor: string; closedAt: Date | null; createdAt: Date;
}

const COLS = `id, tenant_id, period_start, period_end, status, requested_by, requested_at,
  decided_by, decided_at, decision_note, sellers_expected, statements_generated,
  gross_minor, net_minor, closed_at, created_at`;

const toRow = (r: any): CycleRow => ({
  id: r.id, tenantId: r.tenant_id,
  periodStart: typeof r.period_start === 'string' ? r.period_start : r.period_start.toISOString().slice(0, 10),
  periodEnd: typeof r.period_end === 'string' ? r.period_end : r.period_end.toISOString().slice(0, 10),
  status: r.status as CycleStatus,
  requestedBy: r.requested_by ?? null, requestedAt: r.requested_at ?? null,
  decidedBy: r.decided_by ?? null, decidedAt: r.decided_at ?? null, decisionNote: r.decision_note ?? null,
  sellersExpected: r.sellers_expected === null || r.sellers_expected === undefined ? null : Number(r.sellers_expected),
  statementsGenerated: Number(r.statements_generated ?? 0),
  grossMinor: String(r.gross_minor ?? '0'), netMinor: String(r.net_minor ?? '0'),
  closedAt: r.closed_at ?? null, createdAt: r.created_at,
});

@Injectable()
export class SettlementCycleRepository {
  constructor(private readonly pools: PgPoolProvider) {}

  /** Get-or-open the tenant's live cycle for a period. `ON CONFLICT DO NOTHING` on 0144's unique index
   *  means two concurrent first-visits cannot create two cycles over one fortnight. */
  async ensureOpen(tx: TxContext, tenantId: string, period: { startIso: string; endIso: string }): Promise<CycleRow> {
    await tx.query(
      `INSERT INTO settlement_cycles (tenant_id, period_start, period_end, status)
       VALUES ($1, $2::date, $3::date, 'open')
       ON CONFLICT (tenant_id, period_start, period_end) WHERE deleted_at IS NULL DO NOTHING`,
      [tenantId, period.startIso, period.endIso]);
    const r = await tx.query(
      `SELECT ${COLS} FROM settlement_cycles
        WHERE tenant_id=$1 AND period_start=$2::date AND period_end=$3::date AND deleted_at IS NULL`,
      [tenantId, period.startIso, period.endIso]);
    return toRow(r.rows[0]);
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<CycleRow | null> {
    const r = await tx.query(`SELECT ${COLS} FROM settlement_cycles WHERE id=$2 AND tenant_id=$1 AND deleted_at IS NULL FOR UPDATE`, [tenantId, id]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  async getById(tenantId: string, id: string): Promise<CycleRow | null> {
    const r = await this.pools.replica(0).query(`SELECT ${COLS} FROM settlement_cycles WHERE id=$2 AND tenant_id=$1 AND deleted_at IS NULL`, [tenantId, id]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  /** The tenant's live cycle (open / awaiting a checker / generating), if any. */
  async live(tenantId: string): Promise<CycleRow | null> {
    const r = await this.pools.replica(0).query(
      `SELECT ${COLS} FROM settlement_cycles
        WHERE tenant_id=$1 AND status IN ('open','pending_close','closing') AND deleted_at IS NULL
        ORDER BY period_end DESC LIMIT 1`, [tenantId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  async recent(tenantId: string, limit = 6): Promise<CycleRow[]> {
    const r = await this.pools.replica(0).query(
      `SELECT ${COLS} FROM settlement_cycles WHERE tenant_id=$1 AND deleted_at IS NULL
        ORDER BY period_end DESC, id DESC LIMIT ${Math.min(Math.max(limit, 1), 50)}`, [tenantId]);
    return r.rows.map(toRow);
  }

  /** Record the close REQUEST. The status guard in the WHERE is the last defence against two requesters. */
  async requestClose(tx: TxContext, tenantId: string, id: string, requestedBy: string): Promise<boolean> {
    const r = await tx.query(
      `UPDATE settlement_cycles
          SET status='pending_close', requested_by=$3, requested_at=now(), updated_at=now()
        WHERE id=$2 AND tenant_id=$1 AND status='open' AND deleted_at IS NULL`,
      [tenantId, id, requestedBy]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Approve: the cycle moves to `closing` and the EXPECTED seller count is frozen with the decision, so
   *  progress is measured against what was true when the checker signed. */
  async approveClose(tx: TxContext, tenantId: string, id: string, decidedBy: string, sellersExpected: number, note: string | null): Promise<boolean> {
    const r = await tx.query(
      `UPDATE settlement_cycles
          SET status='closing', decided_by=$3, decided_at=now(), decision_note=$4,
              sellers_expected=$5, updated_at=now()
        WHERE id=$2 AND tenant_id=$1 AND status='pending_close' AND deleted_at IS NULL`,
      [tenantId, id, decidedBy, note, sellersExpected]);
    return (r.rowCount ?? 0) > 0;
  }

  async rejectClose(tx: TxContext, tenantId: string, id: string, decidedBy: string, note: string): Promise<boolean> {
    const r = await tx.query(
      `UPDATE settlement_cycles
          SET status='rejected', decided_by=$3, decided_at=now(), decision_note=$4, updated_at=now()
        WHERE id=$2 AND tenant_id=$1 AND status='pending_close' AND deleted_at IS NULL`,
      [tenantId, id, decidedBy, note]);
    return (r.rowCount ?? 0) > 0;
  }

  /** A rejected close returns the cycle to `open` — the period is still live and still needs settling. */
  async reopen(tx: TxContext, tenantId: string, id: string): Promise<boolean> {
    const r = await tx.query(
      `UPDATE settlement_cycles
          SET status='open', requested_by=NULL, requested_at=NULL, decided_by=NULL, decided_at=NULL,
              decision_note=NULL, sellers_expected=NULL, updated_at=now()
        WHERE id=$2 AND tenant_id=$1 AND status='rejected' AND deleted_at IS NULL`,
      [tenantId, id]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Count generation as it happens, so "184 of 186" is read from the rows rather than from a guess. */
  async recount(tx: TxContext, tenantId: string, id: string): Promise<{ generated: number; grossMinor: bigint; netMinor: bigint }> {
    const r = await tx.query<{ n: string; g: string; net: string }>(
      `SELECT count(*)::text n, COALESCE(SUM(gross_minor),0)::text g, COALESCE(SUM(net_minor),0)::text net
         FROM settlement_statements WHERE tenant_id=$1 AND cycle_id=$2`, [tenantId, id]);
    const got = { generated: Number(r.rows[0]?.n ?? 0), grossMinor: BigInt(r.rows[0]?.g ?? '0'), netMinor: BigInt(r.rows[0]?.net ?? '0') };
    await tx.query(
      `UPDATE settlement_cycles SET statements_generated=$3, gross_minor=$4, net_minor=$5, updated_at=now()
        WHERE id=$2 AND tenant_id=$1`,
      [tenantId, id, got.generated, got.grossMinor.toString(), got.netMinor.toString()]);
    return got;
  }

  /** Mark the cycle closed. 0144's CHECK repeats the precondition, so a status cannot outrun the documents
   *  even if a future caller forgets to ask the domain. */
  async markClosed(tx: TxContext, tenantId: string, id: string): Promise<boolean> {
    const r = await tx.query(
      `UPDATE settlement_cycles SET status='closed', closed_at=now(), updated_at=now()
        WHERE id=$2 AND tenant_id=$1 AND status='closing'
              AND sellers_expected IS NOT NULL AND statements_generated >= sellers_expected`,
      [tenantId, id]);
    return (r.rowCount ?? 0) > 0;
  }

  /* ---------------- W147's per-seller table, W148's list ---------------- */

  /** Sellers with UN-statemented lines inside the cycle's days: the rows W147 shows, and the count the
   *  close freezes as `sellers_expected`. gross − commission − tax is carried per seller so the console can
   *  CHECK the arithmetic rather than trusting it. */
  async sellersInPeriod(tenantId: string, period: { startIso: string; endIso: string }, limit = 200): Promise<Array<{
    sellerUserId: string; sellerName: string | null; orders: number;
    grossMinor: string; commissionMinor: string; taxMinor: string; netMinor: string;
  }>> {
    const r = await this.pools.replica(0).query<any>(
      `SELECT l.seller_user_id::text AS seller_user_id, u.full_name AS seller_name,
              count(*)::text AS orders,
              SUM(l.gross_minor)::text AS gross_minor, SUM(l.commission_minor)::text AS commission_minor,
              SUM(l.gst_minor + l.tds_minor)::text AS tax_minor, SUM(l.net_minor)::text AS net_minor
         FROM settlement_lines l
         LEFT JOIN users u ON u.id = l.seller_user_id
        WHERE l.tenant_id = $1 AND l.statement_id IS NULL
              AND l.created_at >= $2::timestamptz AND l.created_at < ($3::date + 1)::timestamptz
        GROUP BY l.seller_user_id, u.full_name
        ORDER BY SUM(l.gross_minor) DESC, l.seller_user_id
        LIMIT ${Math.min(Math.max(limit, 1), 500)}`,
      [tenantId, period.startIso, period.endIso]);
    return r.rows.map((x: any) => ({
      sellerUserId: x.seller_user_id, sellerName: x.seller_name ?? null, orders: Number(x.orders),
      grossMinor: x.gross_minor, commissionMinor: x.commission_minor, taxMinor: x.tax_minor, netMinor: x.net_minor,
    }));
  }

  async countSellersInPeriod(tx: TxContext, tenantId: string, period: { startIso: string; endIso: string }): Promise<{ sellers: number; grossMinor: bigint }> {
    const r = await tx.query<{ n: string; g: string }>(
      `SELECT count(DISTINCT seller_user_id)::text n, COALESCE(SUM(gross_minor),0)::text g
         FROM settlement_lines
        WHERE tenant_id=$1 AND statement_id IS NULL
              AND created_at >= $2::timestamptz AND created_at < ($3::date + 1)::timestamptz`,
      [tenantId, period.startIso, period.endIso]);
    return { sellers: Number(r.rows[0]?.n ?? 0), grossMinor: BigInt(r.rows[0]?.g ?? '0') };
  }

  /** W148's tenant-wide statements list, keyset, newest first. Served by 0144's new index — a finance
   *  console listing every statement had none before this wave. */
  async listStatements(opts: { tenantId: string; cycleId?: string; cursor?: { c: string; id: string }; limit: number }): Promise<Array<{
    id: string; statementNo: string; sellerUserId: string; sellerName: string | null;
    periodStart: string; periodEnd: string; cycleId: string | null;
    grossMinor: string; commissionMinor: string; taxMinor: string; netMinor: string;
    pdfMediaId: string | null; createdAt: Date;
  }>> {
    const params: unknown[] = [opts.tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `s.tenant_id = $1`;
    if (opts.cycleId) where += ` AND s.cycle_id = ${p(opts.cycleId)}`;
    if (opts.cursor) { const cc = p(opts.cursor.c), ci = p(opts.cursor.id); where += ` AND (s.created_at < ${cc} OR (s.created_at = ${cc} AND s.id < ${ci}))`; }
    const r = await this.pools.replica(0).query<any>(
      `SELECT s.id::text AS id, s.statement_no, s.seller_user_id::text AS seller_user_id, u.full_name AS seller_name,
              s.period_start, s.period_end, s.cycle_id::text AS cycle_id,
              s.gross_minor::text AS gross_minor, s.commission_minor::text AS commission_minor,
              s.tax_minor::text AS tax_minor, s.net_minor::text AS net_minor,
              s.pdf_media_id::text AS pdf_media_id, s.created_at
         FROM settlement_statements s
         LEFT JOIN users u ON u.id = s.seller_user_id
        WHERE ${where}
        ORDER BY s.created_at DESC, s.id DESC LIMIT ${Math.min(Math.max(opts.limit, 1), 100)}`,
      params);
    return r.rows.map((x: any) => ({
      id: x.id, statementNo: x.statement_no, sellerUserId: x.seller_user_id, sellerName: x.seller_name ?? null,
      periodStart: typeof x.period_start === 'string' ? x.period_start : x.period_start.toISOString().slice(0, 10),
      periodEnd: typeof x.period_end === 'string' ? x.period_end : x.period_end.toISOString().slice(0, 10),
      cycleId: x.cycle_id ?? null,
      grossMinor: x.gross_minor, commissionMinor: x.commission_minor, taxMinor: x.tax_minor, netMinor: x.net_minor,
      pdfMediaId: x.pdf_media_id ?? null, createdAt: x.created_at,
    }));
  }

  async statementCounts(tenantId: string): Promise<{ total: number; cycleBased: number; legacyDaily: number }> {
    const r = await this.pools.replica(0).query<{ total: string; cyc: string }>(
      `SELECT count(*)::text total, count(*) FILTER (WHERE cycle_id IS NOT NULL)::text cyc
         FROM settlement_statements WHERE tenant_id=$1`, [tenantId]);
    const total = Number(r.rows[0]?.total ?? 0);
    const cyc = Number(r.rows[0]?.cyc ?? 0);
    return { total, cycleBased: cyc, legacyDaily: total - cyc };
  }

  /** The commission rule in force for the tenant — W147's "₹0 because charged_to = buyer" needs the BASIS,
   *  not just the zero. Reads the tenant's own active rule; absent means no rule resolved, and the screen
   *  says that instead of implying a buyer-side arrangement nobody configured. */
  async commissionChargedTo(tenantId: string): Promise<string | null> {
    const r = await this.pools.replica(0).query<{ charged_to: string }>(
      `SELECT charged_to FROM commission_rules
        WHERE tenant_id=$1 AND is_active=true AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 1`, [tenantId]);
    return r.rows[0]?.charged_to ?? null;
  }

  /** The tenant's own ledger movements for a month, grouped by txn type — W148's organisation statement,
   *  DERIVED from the append-only book rather than stored as a copy the book could later contradict. */
  async orgMonthMovements(tenantId: string, period: string): Promise<{ lines: Array<{ txnType: string; creditMinor: string; debitMinor: string; count: number }>; openingMinor: string; closingMinor: string }> {
    const from = `${period}-01`;
    const args = [tenantId, from];
    const lines = await this.pools.replica(0).query<any>(
      `SELECT COALESCE(lv.code, 'unclassified') AS txn_type,
              COALESCE(SUM(e.amount_minor) FILTER (WHERE e.amount_minor > 0), 0)::text AS credit_minor,
              COALESCE(-SUM(e.amount_minor) FILTER (WHERE e.amount_minor < 0), 0)::text AS debit_minor,
              count(*)::text AS n
         FROM ledger_entries e
         JOIN wallet_accounts a ON a.id = e.account_id AND a.owner_kind='tenant' AND a.owner_tenant_id=$1
         JOIN ledger_transactions t ON t.id = e.txn_id
         LEFT JOIN lookup_values lv ON lv.id = t.txn_type_id
        WHERE e.created_at >= $2::timestamptz AND e.created_at < ($2::date + interval '1 month')
        GROUP BY 1 ORDER BY 1`, args);
    const opening = await this.pools.replica(0).query<{ s: string }>(
      `SELECT COALESCE(SUM(e.amount_minor),0)::text s
         FROM ledger_entries e
         JOIN wallet_accounts a ON a.id = e.account_id AND a.owner_kind='tenant' AND a.owner_tenant_id=$1
        WHERE e.created_at < $2::timestamptz`, args);
    const closing = await this.pools.replica(0).query<{ s: string }>(
      `SELECT COALESCE(SUM(e.amount_minor),0)::text s
         FROM ledger_entries e
         JOIN wallet_accounts a ON a.id = e.account_id AND a.owner_kind='tenant' AND a.owner_tenant_id=$1
        WHERE e.created_at < ($2::date + interval '1 month')`, args);
    return {
      lines: lines.rows.map((x: any) => ({ txnType: String(x.txn_type), creditMinor: x.credit_minor, debitMinor: x.debit_minor, count: Number(x.n) })),
      openingMinor: opening.rows[0]?.s ?? '0',
      closingMinor: closing.rows[0]?.s ?? '0',
    };
  }
}
