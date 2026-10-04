// modules/ambassadors/repositories/payout-run.repository.ts · PC-56 TENANT-SW-b · A — all SQL for the three 0198 run tables:
// ambassador_payout_runs, ambassador_payout_run_lines, ambassador_stipend_payments. tenant_id in EVERY query (Law 1) + RLS (ENABLE +
// FORCE, the 0175 split). These tables RECORD money; every move is a WalletPort post the service makes in the same transaction and
// the txn id it returns is what a line carries. The maker-checker wall and the one-open-run rule are the TRIGGER's (trg_apr_moves) —
// this file never checks them in TypeScript, so removing the trigger turns a test red.
import { pgDate, pgDateOrNull } from '../../../core/database/pg-date';
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { FundingCheck, LineStatus, RunKind, RunStatus } from '../domain/payout-run';
import { maskPhone, shortName } from '../domain/display';

export interface RunRow {
  id: string; tenantId: string; kind: RunKind; ambassadorId: string | null; periodStart: string | null; periodEnd: string; payDate: string;
  status: RunStatus; preparedBy: string | null; preparedAt: string; prepareReason: string; confirmedBy: string | null; confirmedAt: string | null;
  confirmReason: string | null; refusedBy: string | null; refusedAt: string | null; refuseReason: string | null;
  totalCommissionMinor: string; totalStipendMinor: string; lineCount: number; fundingCheck: FundingCheck; lastPayCheck: FundingCheck | null;
  paidMinor: string; lastPaidAt: string | null; createdAt: string; createdAtRaw: string;
}
export interface LineRow {
  id: string; runId: string; ambassadorId: string; ambassadorUserId: string; commissionMinor: bigint; earningCount: number; stipendMinor: bigint;
  stipendMonth: string | null; status: LineStatus; shortfallMinor: string | null; failureCode: string | null; attempts: number; payoutId: string | null;
  txnId: string | null; paidAt: string | null; displayName: string | null; phoneMasked: string | null;
}
export interface Candidate { ambassadorId: string; userId: string; commissionMinor: bigint; earningCount: number; monthlyStipendMinor: bigint; isActive: boolean; enrolledAt: Date; suspendedInMonth: boolean; stipendPaid: boolean }

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const RUN_COLS = `id, tenant_id, kind, ambassador_id, period_start, period_end, pay_date::text AS pay_date, status, prepared_by, prepared_at, prepare_reason,
  confirmed_by, confirmed_at, confirm_reason, refused_by, refused_at, refuse_reason, total_commission_minor::text AS tcm, total_stipend_minor::text AS tsm,
  line_count, funding_check, last_pay_check, paid_minor::text AS paid_minor, last_paid_at, created_at, created_at::text AS created_at_raw`;
const toRun = (r: any): RunRow => ({
  id: r.id, tenantId: r.tenant_id, kind: r.kind, ambassadorId: r.ambassador_id ?? null, periodStart: iso(r.period_start), periodEnd: iso(r.period_end) as string,
  payDate: pgDate(r.pay_date), status: r.status, preparedBy: r.prepared_by ?? null, preparedAt: iso(r.prepared_at) as string, prepareReason: r.prepare_reason,
  confirmedBy: r.confirmed_by ?? null, confirmedAt: iso(r.confirmed_at), confirmReason: r.confirm_reason ?? null, refusedBy: r.refused_by ?? null,
  refusedAt: iso(r.refused_at), refuseReason: r.refuse_reason ?? null, totalCommissionMinor: r.tcm, totalStipendMinor: r.tsm, lineCount: Number(r.line_count),
  fundingCheck: r.funding_check, lastPayCheck: r.last_pay_check ?? null, paidMinor: r.paid_minor, lastPaidAt: iso(r.last_paid_at),
  createdAt: iso(r.created_at) as string, createdAtRaw: r.created_at_raw,
});
const LINE_COLS = `l.id, l.run_id, l.ambassador_id, l.ambassador_user_id, l.commission_minor::text AS commission_minor, l.earning_count, l.stipend_minor::text AS stipend_minor,
  l.stipend_month::text AS stipend_month, l.status, l.shortfall_minor::text AS shortfall_minor, l.failure_code, l.attempts, l.payout_id, l.txn_id, l.paid_at`;
const toLine = (r: any): LineRow => ({
  id: r.id, runId: r.run_id, ambassadorId: r.ambassador_id, ambassadorUserId: r.ambassador_user_id, commissionMinor: BigInt(r.commission_minor),
  earningCount: Number(r.earning_count), stipendMinor: BigInt(r.stipend_minor), stipendMonth: pgDateOrNull(r.stipend_month),
  status: r.status, shortfallMinor: r.shortfall_minor ?? null, failureCode: r.failure_code ?? null, attempts: Number(r.attempts), payoutId: r.payout_id ?? null,
  txnId: r.txn_id ?? null, paidAt: iso(r.paid_at), displayName: r.full_name !== undefined ? shortName(r.full_name) : null,
  phoneMasked: r.phone !== undefined ? maskPhone(r.phone ?? '') : null,
});

@Injectable()
export class PayoutRunRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  // ---- the run ----
  async insertRun(tx: TxContext, r: {
    id: string; tenantId: string; kind: RunKind; ambassadorId: string | null; periodStart: Date | null; periodEnd: Date; payDate: string; preparedBy: string | null;
    prepareReason: string; totalCommissionMinor: bigint; totalStipendMinor: bigint; lineCount: number; fundingCheck: FundingCheck;
  }): Promise<void> {
    await tx.query(
      `INSERT INTO ambassador_payout_runs (id, tenant_id, kind, ambassador_id, period_start, period_end, pay_date, prepared_by, prepare_reason,
         total_commission_minor, total_stipend_minor, line_count, funding_check)
       VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12,$13::jsonb)`,
      [r.id, r.tenantId, r.kind, r.ambassadorId, r.periodStart, r.periodEnd, r.payDate, r.preparedBy, r.prepareReason, r.totalCommissionMinor.toString(),
       r.totalStipendMinor.toString(), r.lineCount, JSON.stringify(r.fundingCheck)]);
  }
  async runForUpdate(tx: TxContext, tenantId: string, id: string): Promise<RunRow | null> {
    const r = await tx.query(`SELECT ${RUN_COLS} FROM ambassador_payout_runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, id]);
    return r.rows[0] ? toRun(r.rows[0]) : null;
  }
  async lastWeeklyPeriodEnd(tx: TxContext, tenantId: string): Promise<Date | null> {
    const r = await tx.query(`SELECT max(period_end) AS m FROM ambassador_payout_runs WHERE tenant_id=$1 AND kind='weekly' AND status <> 'refused'`, [tenantId]);
    return r.rows[0]?.m ? new Date(r.rows[0].m) : null;
  }
  async weeklyRunExists(tx: TxContext, tenantId: string, periodEnd: Date): Promise<boolean> {
    const r = await tx.query(`SELECT 1 FROM ambassador_payout_runs WHERE tenant_id=$1 AND kind='weekly' AND period_end=$2 AND status <> 'refused' LIMIT 1`, [tenantId, periodEnd]);
    return (r.rowCount ?? 0) > 0;
  }
  async openRunId(tx: TxContext, tenantId: string): Promise<string | null> {
    const r = await tx.query(`SELECT id FROM ambassador_payout_runs WHERE tenant_id=$1 AND status IN ('prepared','confirmed','partially_paid','unfunded') LIMIT 1`, [tenantId]);
    return r.rows[0]?.id ?? null;
  }
  async confirm(tx: TxContext, tenantId: string, id: string, by: string, reason: string): Promise<number> {
    const r = await tx.query(`UPDATE ambassador_payout_runs SET status='confirmed', confirmed_by=$3, confirmed_at=now(), confirm_reason=$4, updated_at=now()
       WHERE tenant_id=$1 AND id=$2 AND status='prepared'`, [tenantId, id, by, reason]);
    return r.rowCount ?? 0;
  }
  async refuse(tx: TxContext, tenantId: string, id: string, by: string, reason: string): Promise<number> {
    const r = await tx.query(`UPDATE ambassador_payout_runs SET status='refused', refused_by=$3, refused_at=now(), refuse_reason=$4, updated_at=now()
       WHERE tenant_id=$1 AND id=$2 AND status='prepared'`, [tenantId, id, by, reason]);
    return r.rowCount ?? 0;
  }
  async recordPayAttempt(tx: TxContext, tenantId: string, id: string, status: RunStatus, paidMinor: bigint, check: FundingCheck): Promise<void> {
    const r = await tx.query(`UPDATE ambassador_payout_runs SET status=$3, paid_minor=$4, last_pay_check=$5::jsonb, last_paid_at=now(), updated_at=now()
       WHERE tenant_id=$1 AND id=$2`, [tenantId, id, status, paidMinor.toString(), JSON.stringify(check)]);
    if ((r.rowCount ?? 0) !== 1) throw new Error(`ambassador run ${id}: pay attempt matched ${r.rowCount} rows`);
  }

  // ---- what is owed ----
  /** Every ACTIVE ambassador's unpaid earnings up to `periodEnd` (+ the stipend facts for `monthFirst`), bounded. A suspended ambassador's
   *  earnings stay owed (unpaid, never lost) until they are reinstated — the 10a run's rule, kept. */
  async candidates(tx: TxContext, tenantId: string, periodEnd: Date, monthStart: Date, monthEnd: Date, monthFirst: string, onlyAmbassadorId: string | null): Promise<Candidate[]> {
    const r = await tx.query(
      `SELECT a.id, a.user_id, a.monthly_stipend_minor::text AS stipend, a.is_active, a.created_at,
              COALESCE(e.total, 0)::text AS commission, COALESCE(e.n, 0)::int AS n,
              EXISTS (SELECT 1 FROM audit_log al WHERE al.tenant_id = a.tenant_id AND al.entity_type = 'ambassador_profile' AND al.entity_id = a.id
                        AND al.action = 'ambassador.suspended' AND al.created_at >= $3 AND al.created_at < $4) AS suspended_in_month,
              EXISTS (SELECT 1 FROM ambassador_stipend_payments sp WHERE sp.tenant_id = a.tenant_id AND sp.ambassador_id = a.id AND sp.month = $5::date) AS stipend_paid
         FROM ambassador_profiles a
         LEFT JOIN LATERAL (SELECT sum(x.amount_minor) AS total, count(*) AS n FROM ambassador_earnings x
                             WHERE x.tenant_id = a.tenant_id AND x.ambassador_id = a.id AND x.payout_id IS NULL AND x.created_at <= $2) e ON true
        WHERE a.tenant_id = $1 AND a.deleted_at IS NULL AND a.is_active AND ($6::uuid IS NULL OR a.id = $6::uuid)
        ORDER BY a.id LIMIT 5000`,
      [tenantId, periodEnd, monthStart, monthEnd, monthFirst, onlyAmbassadorId]);
    return r.rows.map((x: any) => ({
      ambassadorId: x.id, userId: x.user_id, commissionMinor: BigInt(x.commission), earningCount: Number(x.n), monthlyStipendMinor: BigInt(x.stipend),
      isActive: x.is_active, enrolledAt: new Date(x.created_at), suspendedInMonth: x.suspended_in_month, stipendPaid: x.stipend_paid,
    }));
  }

  // ---- lines ----
  async insertLine(tx: TxContext, l: { id: string; tenantId: string; runId: string; ambassadorId: string; ambassadorUserId: string; commissionMinor: bigint; earningCount: number; stipendMinor: bigint; stipendMonth: string | null }): Promise<void> {
    await tx.query(
      `INSERT INTO ambassador_payout_run_lines (id, tenant_id, run_id, ambassador_id, ambassador_user_id, commission_minor, earning_count, stipend_minor, stipend_month)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date)`,
      [l.id, l.tenantId, l.runId, l.ambassadorId, l.ambassadorUserId, l.commissionMinor.toString(), l.earningCount, l.stipendMinor.toString(), l.stipendMonth]);
  }
  async linesForUpdate(tx: TxContext, tenantId: string, runId: string): Promise<LineRow[]> {
    const r = await tx.query(`SELECT ${LINE_COLS} FROM ambassador_payout_run_lines l WHERE l.tenant_id=$1 AND l.run_id=$2 ORDER BY l.ambassador_id FOR UPDATE`, [tenantId, runId]);
    return r.rows.map(toLine);
  }
  async markLinePaid(tx: TxContext, tenantId: string, id: string, txnId: string): Promise<void> {
    const r = await tx.query(`UPDATE ambassador_payout_run_lines SET status='paid', payout_id=id, txn_id=$3, paid_at=now(), shortfall_minor=NULL, failure_code=NULL,
       attempts=attempts+1, updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status <> 'paid'`, [tenantId, id, txnId]);
    if ((r.rowCount ?? 0) !== 1) throw new Error(`ambassador run line ${id}: paid stamp matched ${r.rowCount} rows`);
  }
  async markLineUnfunded(tx: TxContext, tenantId: string, id: string, shortfall: bigint): Promise<void> {
    await tx.query(`UPDATE ambassador_payout_run_lines SET status='unfunded', shortfall_minor=$3, failure_code=NULL, attempts=attempts+1, updated_at=now()
       WHERE tenant_id=$1 AND id=$2 AND status <> 'paid'`, [tenantId, id, shortfall.toString()]);
  }
  async markLineFailed(tx: TxContext, tenantId: string, id: string, code: string): Promise<void> {
    await tx.query(`UPDATE ambassador_payout_run_lines SET status='failed', failure_code=$3, shortfall_minor=NULL, attempts=attempts+1, updated_at=now()
       WHERE tenant_id=$1 AND id=$2 AND status <> 'paid'`, [tenantId, id, code.slice(0, 60)]);
  }
  async insertStipendPayment(tx: TxContext, s: { tenantId: string; ambassadorId: string; month: string; amountMinor: bigint; runId: string; lineId: string; txnId: string }): Promise<void> {
    await tx.query(
      `INSERT INTO ambassador_stipend_payments (tenant_id, ambassador_id, month, amount_minor, run_id, line_id, txn_id) VALUES ($1,$2,$3::date,$4,$5,$6,$7)`,
      [s.tenantId, s.ambassadorId, s.month, s.amountMinor.toString(), s.runId, s.lineId, s.txnId]);
  }

  // ---- reads (replica) ----
  async get(tenantId: string, id: string): Promise<{ run: RunRow; lines: LineRow[] } | null> {
    const db = this.replica.forTenant(tenantId);
    const r = await db.query(`SELECT ${RUN_COLS} FROM ambassador_payout_runs WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
    if (!r.rows[0]) return null;
    const l = await db.query(`SELECT ${LINE_COLS}, u.full_name, u.phone FROM ambassador_payout_run_lines l JOIN users u ON u.id = l.ambassador_user_id
       WHERE l.tenant_id=$1 AND l.run_id=$2 ORDER BY (l.commission_minor + l.stipend_minor) DESC, l.id`, [tenantId, id]);
    return { run: toRun(r.rows[0]), lines: l.rows.map(toLine) };
  }
  async currentOpen(tenantId: string): Promise<RunRow | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${RUN_COLS} FROM ambassador_payout_runs WHERE tenant_id=$1 AND status IN ('prepared','confirmed','partially_paid','unfunded') ORDER BY created_at DESC LIMIT 1`, [tenantId]);
    return r.rows[0] ? toRun(r.rows[0]) : null;
  }
  async list(tenantId: string, q: { cursor?: { c: string; id: string }; limit: number }): Promise<RunRow[]> {
    const params: unknown[] = [tenantId]; let where = `tenant_id=$1`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc}::timestamptz OR (created_at = ${cc}::timestamptz AND id < ${ci}::uuid))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${RUN_COLS} FROM ambassador_payout_runs WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toRun);
  }
  /** W160 "Owed this week … pays Friday": this ambassador's line in the open run, if any. */
  async openLineFor(tenantId: string, ambassadorId: string): Promise<{ run: RunRow; line: LineRow } | null> {
    const db = this.replica.forTenant(tenantId);
    const r = await db.query(
      `SELECT ${RUN_COLS} FROM ambassador_payout_runs WHERE tenant_id=$1 AND status IN ('prepared','confirmed','partially_paid','unfunded') ORDER BY created_at DESC LIMIT 1`, [tenantId]);
    if (!r.rows[0]) return null;
    const l = await db.query(`SELECT ${LINE_COLS} FROM ambassador_payout_run_lines l WHERE l.tenant_id=$1 AND l.run_id=$2 AND l.ambassador_id=$3`, [tenantId, r.rows[0].id, ambassadorId]);
    return l.rows[0] ? { run: toRun(r.rows[0]), line: toLine(l.rows[0]) } : null;
  }
  /** Stipends ever paid to one ambassador (the detail screen's "earned this year" can name them). */
  async stipendsPaid(tenantId: string, ambassadorId: string): Promise<Array<{ month: string; amountMinor: string; runId: string }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT month::text AS month, amount_minor::text AS amount, run_id FROM ambassador_stipend_payments WHERE tenant_id=$1 AND ambassador_id=$2 ORDER BY month DESC LIMIT 24`, [tenantId, ambassadorId]);
    return r.rows.map((x: any) => ({ month: pgDate(x.month), amountMinor: x.amount, runId: x.run_id }));
  }
}
