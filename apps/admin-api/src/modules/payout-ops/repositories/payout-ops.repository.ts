// apps/admin-api/src/modules/payout-ops/repositories/payout-ops.repository.ts (PC-56 ADMIN-6b)
//
// EVERY MONEY COLUMN CROSSES AS `::text` AND BECOMES bigint HERE. `pg` returns bigint as a string by default and that
// is the behaviour being relied on rather than tolerated — `::text` makes it explicit so a future `pg` type-parser
// registration cannot silently turn a settlement aggregate into a float. Same rule as the ledger-ops repository.
//
// ADMIN-API IS NOT A MONEY WRITER. 0114 grants it SELECT on `payouts` and explicitly REVOKES insert/update/delete: the
// only writes in this file are to `payout_batches` (the approval columns) and `settlement_runs` (the cycle record).
// Marking a payout succeeded belongs to the executor that called a gateway, and a god-mode realm that could do it
// without one would be able to forge a disbursement.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import { BatchRow } from '../domain/batch-approval';
import { SettlementRunRow, StatementRow, parseMinor } from '../domain/settlement-cycle';
import type { PreflightSubject } from '../domain/preflight-view';

const BATCH_COLS = `id, tenant_id, batch_type, total_minor::text AS total_minor, count, status, executed_at,
  opened_by_admin_id, approved_by_admin_id, approved_at, returned_by_admin_id, returned_at, return_reason,
  preflight, preflight_at, created_at`;

const RUN_COLS = `id, period_start, period_end, status, sellers_scanned, generated_count, failed_count,
  gross_minor::text AS gross_minor, commission_minor::text AS commission_minor, tax_minor::text AS tax_minor,
  net_minor::text AS net_minor, finished_at, triggered_by_admin_id, failure_detail, created_at`;

const STMT_COLS = `id, tenant_id, seller_user_id, statement_no, period_start, period_end,
  gross_minor::text AS gross_minor, commission_minor::text AS commission_minor, tax_minor::text AS tax_minor,
  net_minor::text AS net_minor, pdf_media_id, pdf_sha256, pdf_hashed_at, run_id, created_at`;

function toBatch(r: Record<string, unknown>): BatchRow {
  return {
    id: String(r.id), tenantId: (r.tenant_id as string | null) ?? null, batchType: String(r.batch_type),
    totalMinor: parseMinor(r.total_minor, 'batch total'), count: Number(r.count), status: String(r.status),
    executedAt: (r.executed_at as string | null) ?? null,
    openedByAdminId: (r.opened_by_admin_id as string | null) ?? null,
    approvedByAdminId: (r.approved_by_admin_id as string | null) ?? null,
    approvedAt: (r.approved_at as string | null) ?? null,
    returnedByAdminId: (r.returned_by_admin_id as string | null) ?? null,
    returnedAt: (r.returned_at as string | null) ?? null,
    returnReason: (r.return_reason as string | null) ?? null,
    preflight: (r.preflight as Record<string, unknown> | null) ?? null,
    preflightAt: (r.preflight_at as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

function toRun(r: Record<string, unknown>): SettlementRunRow {
  return {
    id: String(r.id), periodStart: String(r.period_start).slice(0, 10), periodEnd: String(r.period_end).slice(0, 10),
    status: String(r.status), sellersScanned: Number(r.sellers_scanned), generatedCount: Number(r.generated_count),
    failedCount: Number(r.failed_count),
    grossMinor: parseMinor(r.gross_minor, 'gross'), commissionMinor: parseMinor(r.commission_minor, 'commission'),
    taxMinor: parseMinor(r.tax_minor, 'tax'), netMinor: parseMinor(r.net_minor, 'net'),
    finishedAt: (r.finished_at as string | null) ?? null,
    triggeredByAdminId: (r.triggered_by_admin_id as string | null) ?? null,
    failureDetail: (r.failure_detail as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

function toStatement(r: Record<string, unknown>): StatementRow {
  return {
    id: String(r.id), tenantId: String(r.tenant_id), sellerUserId: String(r.seller_user_id),
    statementNo: String(r.statement_no),
    periodStart: String(r.period_start).slice(0, 10), periodEnd: String(r.period_end).slice(0, 10),
    grossMinor: parseMinor(r.gross_minor, 'gross'), commissionMinor: parseMinor(r.commission_minor, 'commission'),
    taxMinor: parseMinor(r.tax_minor, 'tax'), netMinor: parseMinor(r.net_minor, 'net'),
    pdfMediaId: (r.pdf_media_id as string | null) ?? null,
    pdfSha256: (r.pdf_sha256 as string | null) ?? null,
    pdfHashedAt: (r.pdf_hashed_at as string | null) ?? null,
    runId: (r.run_id as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

@Injectable()
export class PayoutOpsRepository {
  constructor(private readonly db: AdminPool) {}

  /* ---------------------------------------------------------------------- */
  /* PAYOUT BATCHES — W066, W067                                            */
  /* ---------------------------------------------------------------------- */

  /** Keyset on `(created_at, id)`, newest first — W066's "Created ▾". `idx_payout_batches_recent` (0114) serves it;
   *  before that migration this list had no index at all. */
  async listBatches(o: {
    status?: string; batchType?: string; tenantId?: string;
    cursor?: { c: string; id: string }; limit: number;
  }): Promise<BatchRow[]> {
    const p: unknown[] = [];
    const b = (v: unknown) => { p.push(v); return `$${p.length}`; };
    let where = '1=1';
    if (o.status) where += ` AND status = ${b(o.status)}`;
    if (o.batchType) where += ` AND batch_type = ${b(o.batchType)}`;
    if (o.tenantId) where += ` AND tenant_id = ${b(o.tenantId)}`;
    if (o.cursor) {
      const cc = b(o.cursor.c); const ci = b(o.cursor.id);
      where += ` AND (created_at < ${cc} OR (created_at = ${cc} AND id < ${ci}))`;
    }
    const lp = b(o.limit);
    const r = await this.db.query(
      `SELECT ${BATCH_COLS} FROM payout_batches WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, p);
    return r.rows.map(toBatch);
  }

  async getBatch(id: string): Promise<BatchRow | null> {
    const r = await this.db.query(`SELECT ${BATCH_COLS} FROM payout_batches WHERE id = $1`, [id]);
    return r.rows[0] ? toBatch(r.rows[0]) : null;
  }

  /** The same read, inside the caller's transaction and FOR UPDATE.
   *
   *  The conditional `WHERE status='open'` on the write is what actually prevents two checkers both approving, but the
   *  DECISION is made from a row read beforehand — and a decision made outside the transaction that acts on it is a
   *  decision made against a snapshot that may already be stale. Locking the row means the preflight, the two-person
   *  assertion and the write all see one state of the world. On the money door that is worth a row lock. */
  async getBatchForUpdate(c: PoolClient, id: string): Promise<BatchRow | null> {
    const r = await c.query(`SELECT ${BATCH_COLS} FROM payout_batches WHERE id = $1 FOR UPDATE`, [id]);
    return r.rows[0] ? toBatch(r.rows[0]) : null;
  }

  /** W067's alert strip: "PB-0713-02 awaits checker — ₹4,82,120 to 214 farmers. Maker: Priya S."
   *
   *  Read across EVERY open batch rather than the current page, for the same reason ADMIN-5f read the safety count
   *  across every open report: a desk that is only told about what happens to be on screen is a desk that misses things
   *  when the list is long. `idx_payout_batches_awaiting` is the partial index for it. */
  async awaitingChecker(limit = 5): Promise<Array<{ id: string; batchType: string; totalMinor: bigint; count: number; openedByAdminId: string | null; createdAt: string }>> {
    const r = await this.db.query(
      `SELECT b.id, b.batch_type, b.count, b.opened_by_admin_id, b.created_at,
              COALESCE((SELECT SUM(p.amount_minor) FROM payouts p WHERE p.batch_id = b.id AND p.status = 'queued'), 0)::text AS requested_minor
         FROM payout_batches b
        WHERE b.status = 'open'
        ORDER BY b.created_at ASC
        LIMIT $1`, [limit]);
    return r.rows.map((x) => ({
      id: String(x.id), batchType: String(x.batch_type), count: Number(x.count),
      // The Σ of the payouts INSIDE it, not `total_minor` — which is 0 on an open batch because it only accumulates as
      // disbursements succeed. Showing `total_minor` on an awaiting-checker strip would read "₹0 awaiting approval".
      totalMinor: parseMinor(x.requested_minor, 'requested'),
      openedByAdminId: (x.opened_by_admin_id as string | null) ?? null,
      createdAt: String(x.created_at),
    }));
  }

  /** Σ of the payouts under review in a batch. Separate from `total_minor` for the reason above, and `batchMoney` in
   *  the domain reports both side by side. */
  async batchRequestedMinor(batchId: string): Promise<bigint> {
    const r = await this.db.query(
      `SELECT COALESCE(SUM(amount_minor), 0)::text AS total FROM payouts WHERE batch_id = $1`, [batchId]);
    return parseMinor(r.rows[0]?.total ?? '0', 'requested');
  }

  /* ---------------------------------------------------------------------- */
  /* THE PREFLIGHT — W067's panel                                           */
  /* ---------------------------------------------------------------------- */

  /** Everything the preflight needs about one batch's payouts, in ONE query.
   *
   *  FOUR JOINS AND NOT ONE OF THEM RETURNS AN ACCOUNT NUMBER. `account_last4` is the most of a bank account that
   *  crosses into this realm, and `penny_verified_at` is projected as a BOOLEAN — an approval screen has no need for the
   *  date somebody's account was verified, and a column that arrives is a column that ends up in an export.
   *
   *  `kyc_status` is taken from the payee's most permissive ACTIVE role in the payout's own tenant. `MIN` over an
   *  ordering that puts 'verified' first, expressed as a boolean aggregate instead: a user with three roles, one
   *  verified, is verified. NULL when there is no active role at all, which the domain reports as `kyc_unknown` rather
   *  than folding into a failure — "we could not find out" and "we checked and it is expired" send an operator to
   *  different places.
   *
   *  `is_frozen` is read from the payee's MAIN wallet account. It has never gated a payout (the success legs touch only
   *  platform accounts — the farmer's balance was debited at request time), so this is the first code on the platform
   *  that connects the recon console's freeze control to money leaving. */
  async preflightSubjects(batchId: string, limit = 5_000): Promise<PreflightSubject[]> {
    const r = await this.db.query(
      `SELECT p.id, p.user_id, p.amount_minor::text AS amount_minor, p.status,
              (ba.penny_verified_at IS NOT NULL) AS bank_verified,
              ba.account_last4,
              (SELECT bool_or(utr.kyc_status = 'verified')
                 FROM user_tenant_roles utr
                WHERE utr.user_id = p.user_id AND utr.tenant_id = p.tenant_id
                  AND utr.is_active = true AND utr.deleted_at IS NULL) AS kyc_ok,
              (SELECT count(*) > 0
                 FROM user_tenant_roles utr
                WHERE utr.user_id = p.user_id AND utr.tenant_id = p.tenant_id
                  AND utr.is_active = true AND utr.deleted_at IS NULL) AS has_active_role,
              COALESCE((SELECT wa.is_frozen FROM wallet_accounts wa
                         WHERE wa.owner_kind = 'user' AND wa.owner_id = p.user_id
                           AND wa.account_code = 'main' LIMIT 1), false) AS wallet_frozen
         FROM payouts p
         LEFT JOIN bank_accounts ba ON ba.id = p.bank_account_id
        WHERE p.batch_id = $1
        ORDER BY p.priority ASC, p.created_at ASC
        LIMIT $2`, [batchId, limit]);
    return r.rows.map((x) => ({
      payoutId: String(x.id),
      userId: (x.user_id as string | null) ?? null,
      amountMinor: parseMinor(x.amount_minor, 'payout amount'),
      bankVerified: x.bank_verified === true,
      bankLast4: (x.account_last4 as string | null) ?? null,
      // `has_active_role` false → null (unknown). Otherwise 'verified' or a non-passing marker; the domain's allow-list
      // is what decides, so this deliberately does not encode a verdict.
      kycStatus: x.has_active_role === true ? (x.kyc_ok === true ? 'verified' : 'not_verified') : null,
      walletFrozen: x.wallet_frozen === true,
      status: String(x.status),
    }));
  }

  /** W067's line-item table: payout, payee, purpose, bank, amount, status, priority. Keyset paged. */
  async listBatchPayouts(batchId: string, o: { cursor?: { pr: number; c: string; id: string }; limit: number }): Promise<Array<{
    id: string; userId: string | null; purposeCode: string | null; bankLast4: string | null; bankIfsc: string | null;
    amountMinor: bigint; status: string; priority: number; failureCode: string | null; createdAt: string;
  }>> {
    const p: unknown[] = [batchId];
    const b = (v: unknown) => { p.push(v); return `$${p.length}`; };
    let where = 'p.batch_id = $1';
    if (o.cursor) {
      // Keyset on the SAME ordering the executor drains in — `(priority, created_at, id)`. A pager ordered differently
      // from the queue would show an operator a different sequence from the one the money will follow.
      const pr = b(o.cursor.pr); const cc = b(o.cursor.c); const ci = b(o.cursor.id);
      where += ` AND (p.priority > ${pr} OR (p.priority = ${pr} AND (p.created_at > ${cc} OR (p.created_at = ${cc} AND p.id > ${ci}))))`;
    }
    const lp = b(o.limit);
    const r = await this.db.query(
      `SELECT p.id, p.user_id, p.amount_minor::text AS amount_minor, p.status, p.priority, p.failure_code, p.created_at,
              lv.code AS purpose_code, ba.account_last4, ba.ifsc
         FROM payouts p
         LEFT JOIN lookup_values lv ON lv.id = p.purpose_id
         LEFT JOIN bank_accounts ba ON ba.id = p.bank_account_id
        WHERE ${where}
        ORDER BY p.priority ASC, p.created_at ASC, p.id ASC
        LIMIT ${lp}`, p);
    return r.rows.map((x) => ({
      id: String(x.id), userId: (x.user_id as string | null) ?? null,
      purposeCode: (x.purpose_code as string | null) ?? null,
      bankLast4: (x.account_last4 as string | null) ?? null, bankIfsc: (x.ifsc as string | null) ?? null,
      amountMinor: parseMinor(x.amount_minor, 'payout amount'), status: String(x.status),
      priority: Number(x.priority), failureCode: (x.failure_code as string | null) ?? null,
      createdAt: String(x.created_at),
    }));
  }

  /* ---------------------------------------------------------------------- */
  /* THE WRITES — the only two in this module                               */
  /* ---------------------------------------------------------------------- */

  /** Approve, CONDITIONALLY on the batch still being open.
   *
   *  `WHERE status = 'open'` is not belt-and-braces; it is the concurrency control. Two checkers opening the same batch
   *  and both pressing Approve would otherwise both succeed, and the second would overwrite the first's name on a
   *  disbursement they did not authorise. Returns whether the row moved, so the service can tell the loser what
   *  happened instead of showing them a success page for somebody else's act.
   *
   *  0114's `ck_payout_batch_approval_evidence` makes the pair unrepresentable, and
   *  `ck_payout_batches_maker_ne_checker` refuses self-approval, so a bug here fails loudly at the database rather than
   *  quietly at the money door. */
  async approveBatch(c: PoolClient, id: string, approverAdminId: string, preflight: Record<string, unknown>): Promise<boolean> {
    const r = await c.query(
      `UPDATE payout_batches
          SET status = 'approved', approved_by_admin_id = $2, approved_at = now(),
              preflight = $3::jsonb, preflight_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'open'`,
      [id, approverAdminId, JSON.stringify(preflight)]);
    return (r.rowCount ?? 0) > 0;
  }

  async returnBatch(c: PoolClient, id: string, returnerAdminId: string, reason: string): Promise<boolean> {
    const r = await c.query(
      `UPDATE payout_batches
          SET status = 'returned', returned_by_admin_id = $2, returned_at = now(), return_reason = $3, updated_at = now()
        WHERE id = $1 AND status = 'open'`,
      [id, returnerAdminId, reason.trim()]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Record the preflight WITHOUT approving. W067's panel is refreshable, and a checker who runs the checks and then
   *  walks away has still established something worth keeping — particularly a FAILING result, which is the evidence
   *  that somebody looked. */
  async recordPreflight(c: PoolClient, id: string, preflight: Record<string, unknown>): Promise<void> {
    await c.query(
      `UPDATE payout_batches SET preflight = $2::jsonb, preflight_at = now(), updated_at = now() WHERE id = $1`,
      [id, JSON.stringify(preflight)]);
  }

  /** How much money is held behind unapproved batches. The gate in apps/api is silent by design (it skips rather than
   *  raising), and 0113's lesson was that a silent guard needs a number published somewhere or it is indistinguishable
   *  from a stalled queue. */
  async awaitingApprovalTotal(): Promise<{ count: number; totalMinor: bigint } | null> {
    const r = await this.db.query(
      `SELECT count(*)::text AS n, COALESCE(SUM(p.amount_minor), 0)::text AS total
         FROM payouts p JOIN payout_batches b ON b.id = p.batch_id
        WHERE p.status = 'queued' AND b.status NOT IN ('approved','executing')`);
    const row = r.rows[0];
    if (!row) return null;
    return { count: Number(row.n), totalMinor: parseMinor(row.total, 'awaiting total') };
  }

  /* ---------------------------------------------------------------------- */
  /* SETTLEMENT — W062, W063, W442                                          */
  /* ---------------------------------------------------------------------- */

  async listRuns(o: { status?: string; cursor?: { c: string; id: string }; limit: number }): Promise<SettlementRunRow[]> {
    const p: unknown[] = [];
    const b = (v: unknown) => { p.push(v); return `$${p.length}`; };
    let where = 'deleted_at IS NULL';
    if (o.status) where += ` AND status = ${b(o.status)}`;
    if (o.cursor) {
      const cc = b(o.cursor.c); const ci = b(o.cursor.id);
      where += ` AND (created_at < ${cc} OR (created_at = ${cc} AND id < ${ci}))`;
    }
    const lp = b(o.limit);
    const r = await this.db.query(
      `SELECT ${RUN_COLS} FROM settlement_runs WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, p);
    return r.rows.map(toRun);
  }

  /** The newest run for a period, or the newest run at all. Returns NULL rather than a zeroed row — W062's tiles
   *  distinguish "no cycle today" from "a cycle that settled nothing", and a synthesised empty row would erase that. */
  async latestRun(period?: string | null): Promise<SettlementRunRow | null> {
    const r = period
      ? await this.db.query(
        `SELECT ${RUN_COLS} FROM settlement_runs WHERE deleted_at IS NULL AND period_end = $1
          ORDER BY created_at DESC LIMIT 1`, [period])
      : await this.db.query(
        `SELECT ${RUN_COLS} FROM settlement_runs WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`);
    return r.rows[0] ? toRun(r.rows[0]) : null;
  }

  async getRun(id: string): Promise<SettlementRunRow | null> {
    const r = await this.db.query(
      `SELECT ${RUN_COLS} FROM settlement_runs WHERE id = $1 AND deleted_at IS NULL`, [id]);
    return r.rows[0] ? toRun(r.rows[0]) : null;
  }

  /** Open a run row for an on-demand cycle. `triggered_by_admin_id` is the operator, so a console-run cycle is
   *  distinguishable from the cadence — a run row that said NULL for both would make the two indistinguishable, and
   *  "who asked for this cycle" is the first question after an unexpected one. */
  async openRunTx(c: PoolClient, periodStart: string, periodEnd: string, adminId: string | null): Promise<string> {
    const r = await c.query(
      `INSERT INTO settlement_runs (period_start, period_end, status, triggered_by_admin_id)
       VALUES ($1, $2, 'running', $3) RETURNING id`, [periodStart, periodEnd, adminId]);
    return String(r.rows[0].id);
  }

  /** W062's list: statements for a cycle, tenant-filterable, keyset. `idx_settlement_statements_period` (0114) serves
   *  it — the table previously had only its PK and `UNIQUE (tenant_id, statement_no)`, so this read was a full scan. */
  async listStatements(o: {
    periodEnd?: string | null; tenantId?: string; runId?: string;
    cursor?: { c: string; id: string }; limit: number;
  }): Promise<StatementRow[]> {
    const p: unknown[] = [];
    const b = (v: unknown) => { p.push(v); return `$${p.length}`; };
    let where = 'deleted_at IS NULL';
    if (o.periodEnd) where += ` AND period_end = ${b(o.periodEnd)}`;
    if (o.tenantId) where += ` AND tenant_id = ${b(o.tenantId)}`;
    if (o.runId) where += ` AND run_id = ${b(o.runId)}`;
    if (o.cursor) {
      const cc = b(o.cursor.c); const ci = b(o.cursor.id);
      where += ` AND (created_at < ${cc} OR (created_at = ${cc} AND id < ${ci}))`;
    }
    const lp = b(o.limit);
    const r = await this.db.query(
      `SELECT ${STMT_COLS} FROM settlement_statements WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, p);
    return r.rows.map(toStatement);
  }

  async getStatement(id: string): Promise<StatementRow | null> {
    const r = await this.db.query(
      `SELECT ${STMT_COLS} FROM settlement_statements WHERE id = $1 AND deleted_at IS NULL`, [id]);
    return r.rows[0] ? toStatement(r.rows[0]) : null;
  }

  /** W063's order lines. From `settlement_lines` (0019) — the per-order seller-tagged breakdown, which is the only
   *  place this attribution exists; the ledger records the money moves and cannot cleanly attribute commission and TDS
   *  back to one seller's one order. */
  async statementLines(statementId: string, limit = 500): Promise<Array<{
    id: string; orderId: string; grossMinor: bigint; commissionMinor: bigint; gstMinor: bigint; tdsMinor: bigint;
    netMinor: bigint; createdAt: string;
  }>> {
    const r = await this.db.query(
      `SELECT id, order_id, gross_minor::text AS gross_minor, commission_minor::text AS commission_minor,
              gst_minor::text AS gst_minor, tds_minor::text AS tds_minor, net_minor::text AS net_minor, created_at
         FROM settlement_lines WHERE statement_id = $1 ORDER BY created_at ASC LIMIT $2`, [statementId, limit]);
    return r.rows.map((x) => ({
      id: String(x.id), orderId: String(x.order_id),
      grossMinor: parseMinor(x.gross_minor, 'line gross'), commissionMinor: parseMinor(x.commission_minor, 'line commission'),
      gstMinor: parseMinor(x.gst_minor, 'line gst'), tdsMinor: parseMinor(x.tds_minor, 'line tds'),
      netMinor: parseMinor(x.net_minor, 'line net'), createdAt: String(x.created_at),
    }));
  }

  /** The statement's cycle totals, for W062's four tiles when a run row exists but its aggregates are zero (every
   *  statement generated before 0114 has no `run_id`, so the run's own columns cannot describe them). Computed over
   *  the PERIOD rather than the run, and the service labels which of the two it used — a total that silently switches
   *  its own basis is worse than one that is missing. */
  async periodTotals(periodEnd: string): Promise<{ statements: number; grossMinor: bigint; commissionMinor: bigint; taxMinor: bigint; netMinor: bigint }> {
    const r = await this.db.query(
      `SELECT count(*)::text AS n,
              COALESCE(SUM(gross_minor),0)::text AS gross, COALESCE(SUM(commission_minor),0)::text AS commission,
              COALESCE(SUM(tax_minor),0)::text AS tax, COALESCE(SUM(net_minor),0)::text AS net
         FROM settlement_statements WHERE deleted_at IS NULL AND period_end = $1`, [periodEnd]);
    const x = r.rows[0] ?? {};
    return {
      statements: Number(x.n ?? '0'),
      grossMinor: parseMinor(x.gross ?? '0', 'gross'), commissionMinor: parseMinor(x.commission ?? '0', 'commission'),
      taxMinor: parseMinor(x.tax ?? '0', 'tax'), netMinor: parseMinor(x.net ?? '0', 'net'),
    };
  }
}
