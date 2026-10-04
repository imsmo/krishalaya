// modules/labour/repositories/wage-run.repository.ts · PC-56 TENANT-SW-b · C1 — all SQL for labour_wage_runs + labour_wage_run_lines (0198)
// and the W166 reads (today's run, history, manual pay acts, advances outstanding). tenant_id in EVERY query (Law 1) + RLS (0175 split).
// These tables RECORD what the daily run did; every money move is the 11b pay run's WalletPort post, in the booking's own transaction.
import { pgDate, pgDateOrNull } from '../../../core/database/pg-date';
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { WageLineStatus } from '../domain/wage-run';
import { maskPhone, shortName } from '../domain/display';

export interface WageRunRow {
  id: string; runDate: string; status: string; preparedBy: string | null; bookingsConsidered: number; lineCount: number; grossMinor: string;
  advanceRecoveryMinor: string; netMinor: string; startedAt: string; finishedAt: string | null;
}
export interface WageLineRow {
  id: string; runId: string; bookingId: string; bookingNo: string | null; assignmentId: string; workerId: string; workerShortName: string | null; workerPhoneMasked: string | null;
  payoutId: string | null; grossMinor: string; advanceRecoveryMinor: string; netMinor: string; daysConfirmed: number; status: WageLineStatus; attempts: number;
  nextRetryAt: string | null; lastError: string | null; runDate?: string;
}
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const RUN_COLS = `id, run_date::text AS run_date, status, prepared_by, bookings_considered, line_count, gross_minor::text AS gross, advance_recovery_minor::text AS rec,
  net_minor::text AS net, started_at, finished_at`;
const toRun = (r: any): WageRunRow => ({ id: r.id, runDate: pgDate(r.run_date), status: r.status, preparedBy: r.prepared_by ?? null,
  bookingsConsidered: Number(r.bookings_considered), lineCount: Number(r.line_count), grossMinor: r.gross, advanceRecoveryMinor: r.rec, netMinor: r.net,
  startedAt: iso(r.started_at) as string, finishedAt: iso(r.finished_at) });
const LINE_SELECT = `l.id, l.run_id, l.booking_id, b.booking_no, l.assignment_id, l.worker_id, l.payout_id, l.gross_minor::text AS gross, l.advance_recovery_minor::text AS rec,
  l.net_minor::text AS net, l.days_confirmed, l.status, l.attempts, l.next_retry_at, l.last_error, u.full_name, u.phone, r.run_date::text AS run_date`;
const LINE_FROM = `labour_wage_run_lines l JOIN labour_wage_runs r ON r.id = l.run_id JOIN labour_bookings b ON b.id = l.booking_id
  JOIN worker_profiles wp ON wp.id = l.worker_id JOIN users u ON u.id = wp.user_id`;
const toLine = (x: any): WageLineRow => ({
  id: x.id, runId: x.run_id, bookingId: x.booking_id, bookingNo: x.booking_no ?? null, assignmentId: x.assignment_id, workerId: x.worker_id,
  workerShortName: shortName(x.full_name), workerPhoneMasked: maskPhone(x.phone ?? ''), payoutId: x.payout_id ?? null, grossMinor: x.gross, advanceRecoveryMinor: x.rec,
  netMinor: x.net, daysConfirmed: Number(x.days_confirmed), status: x.status, attempts: Number(x.attempts), nextRetryAt: iso(x.next_retry_at), lastError: x.last_error ?? null,
  runDate: pgDateOrNull(x.run_date) ?? undefined,
});

@Injectable()
export class WageRunRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  // ---- the run ----
  /** The run for (tenant, IST day), created if absent (UNIQUE (tenant, run_date): two pods → one run). Returns null if it already existed. */
  async createRun(tx: TxContext, tenantId: string, id: string, runDate: string): Promise<string | null> {
    const r = await tx.query(`INSERT INTO labour_wage_runs (id, tenant_id, run_date) VALUES ($1,$2,$3::date) ON CONFLICT (tenant_id, run_date) DO NOTHING RETURNING id`, [id, tenantId, runDate]);
    return r.rows[0]?.id ?? null;
  }
  async runFor(tenantId: string, runDate: string, tx?: TxContext): Promise<WageRunRow | null> {
    const sql = `SELECT ${RUN_COLS} FROM labour_wage_runs WHERE tenant_id=$1 AND run_date=$2::date`;
    const r = tx ? await tx.query(sql, [tenantId, runDate]) : await this.replica.forTenant(tenantId).query(sql, [tenantId, runDate]);
    return r.rows[0] ? toRun(r.rows[0]) : null;
  }
  async runById(tenantId: string, id: string): Promise<WageRunRow | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${RUN_COLS} FROM labour_wage_runs WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
    return r.rows[0] ? toRun(r.rows[0]) : null;
  }
  /** Recompute a run's totals and status from its lines (in the caller's tx). */
  async refreshRun(tx: TxContext, tenantId: string, runId: string, status: string, bookingsConsidered?: number): Promise<void> {
    await tx.query(
      `UPDATE labour_wage_runs r SET status=$3, line_count=t.n, gross_minor=t.g, advance_recovery_minor=t.rec, net_minor=t.net,
              bookings_considered=COALESCE($4, r.bookings_considered), finished_at=now(), updated_at=now()
         FROM (SELECT count(*)::int AS n, COALESCE(sum(gross_minor) FILTER (WHERE status='paid'),0) AS g,
                      COALESCE(sum(advance_recovery_minor) FILTER (WHERE status='paid'),0) AS rec, COALESCE(sum(net_minor) FILTER (WHERE status='paid'),0) AS net
                 FROM labour_wage_run_lines WHERE tenant_id=$1 AND run_id=$2) t
        WHERE r.tenant_id=$1 AND r.id=$2`, [tenantId, runId, status, bookingsConsidered ?? null]);
  }
  async lineStatuses(tx: TxContext, tenantId: string, runId: string): Promise<Array<{ status: WageLineStatus }>> {
    const r = await tx.query(`SELECT status FROM labour_wage_run_lines WHERE tenant_id=$1 AND run_id=$2`, [tenantId, runId]);
    return r.rows as Array<{ status: WageLineStatus }>;
  }

  // ---- what is due ----
  /** Bookings with money the daily run should pay: confirmed-but-unpaid days, or 11b payout rows awaiting a top-up — and NOT owned by the
   *  retry ladder (a booking with a line still `retrying` is retried at 16:00, not re-run at 18:00). Bounded. */
  async bookingsDue(tx: TxContext, tenantId: string, limit = 500): Promise<string[]> {
    const r = await tx.query(
      `SELECT b.id FROM labour_bookings b
        WHERE b.tenant_id=$1 AND b.status IN ('in_progress','completed') AND b.deleted_at IS NULL
          AND (EXISTS (SELECT 1 FROM attendance_records ar JOIN booking_assignments ba ON ba.id = ar.assignment_id AND ba.tenant_id = ar.tenant_id
                        WHERE ar.tenant_id=$1 AND ba.booking_id = b.id AND ar.confirmed_by_employer AND ar.wage_payout_id IS NULL)
            OR EXISTS (SELECT 1 FROM labour_wage_payouts p WHERE p.tenant_id=$1 AND p.booking_id = b.id AND p.status IN ('awaiting_topup','partial')))
          AND NOT EXISTS (SELECT 1 FROM labour_wage_run_lines l WHERE l.tenant_id=$1 AND l.booking_id = b.id AND l.status='retrying')
        ORDER BY b.id LIMIT $2`, [tenantId, limit]);
    return r.rows.map((x: { id: string }) => x.id);
  }
  /** Assignments of a booking with confirmed-unpaid days (what a failed booking owed — the lines that will retry). */
  async owedAssignments(tx: TxContext, tenantId: string, bookingId: string): Promise<Array<{ assignmentId: string; workerId: string; days: number }>> {
    const r = await tx.query(
      `SELECT ba.id, ba.worker_id, count(ar.id)::int AS days FROM booking_assignments ba
         JOIN attendance_records ar ON ar.assignment_id = ba.id AND ar.tenant_id = ba.tenant_id AND ar.confirmed_by_employer AND ar.wage_payout_id IS NULL
        WHERE ba.tenant_id=$1 AND ba.booking_id=$2 GROUP BY ba.id, ba.worker_id`, [tenantId, bookingId]);
    return r.rows.map((x: any) => ({ assignmentId: x.id, workerId: x.worker_id, days: Number(x.days) }));
  }
  /** Lines whose retry is due, grouped by booking (the 16:00 retry pass). */
  async retriesDue(tx: TxContext, tenantId: string, now: Date): Promise<Array<{ bookingId: string; runId: string; lines: Array<{ id: string; assignmentId: string; attempts: number }> }>> {
    const r = await tx.query(`SELECT id, run_id, booking_id, assignment_id, attempts FROM labour_wage_run_lines WHERE tenant_id=$1 AND status='retrying' AND next_retry_at <= $2
       ORDER BY booking_id, id FOR UPDATE`, [tenantId, now]);
    const by = new Map<string, { bookingId: string; runId: string; lines: Array<{ id: string; assignmentId: string; attempts: number }> }>();
    for (const x of r.rows as any[]) {
      const k = `${x.run_id}:${x.booking_id}`;
      if (!by.has(k)) by.set(k, { bookingId: x.booking_id, runId: x.run_id, lines: [] });
      by.get(k)!.lines.push({ id: x.id, assignmentId: x.assignment_id, attempts: Number(x.attempts) });
    }
    return [...by.values()];
  }

  // ---- lines ----
  async upsertPaidLine(tx: TxContext, l: { tenantId: string; runId: string; bookingId: string; assignmentId: string; workerId: string; payoutId: string | null; grossMinor: bigint; recoveryMinor: bigint; netMinor: bigint; days: number; status: 'paid' | 'skipped_unfunded' }): Promise<void> {
    await tx.query(
      `INSERT INTO labour_wage_run_lines (tenant_id, run_id, booking_id, assignment_id, worker_id, payout_id, gross_minor, advance_recovery_minor, net_minor, days_confirmed, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (run_id, assignment_id) DO UPDATE SET payout_id=EXCLUDED.payout_id, gross_minor=labour_wage_run_lines.gross_minor + EXCLUDED.gross_minor,
         advance_recovery_minor=labour_wage_run_lines.advance_recovery_minor + EXCLUDED.advance_recovery_minor, net_minor=labour_wage_run_lines.net_minor + EXCLUDED.net_minor,
         days_confirmed=labour_wage_run_lines.days_confirmed + EXCLUDED.days_confirmed, status=EXCLUDED.status, next_retry_at=NULL, updated_at=now()
         WHERE labour_wage_run_lines.status NOT IN ('paid','failed')`,
      [l.tenantId, l.runId, l.bookingId, l.assignmentId, l.workerId, l.payoutId, l.grossMinor.toString(), l.recoveryMinor.toString(), l.netMinor.toString(), l.days, l.status]);
  }
  async insertRetryingLine(tx: TxContext, l: { tenantId: string; runId: string; bookingId: string; assignmentId: string; workerId: string; days: number; nextRetryAt: Date; error: string }): Promise<void> {
    await tx.query(
      `INSERT INTO labour_wage_run_lines (tenant_id, run_id, booking_id, assignment_id, worker_id, days_confirmed, status, attempts, next_retry_at, last_error)
       VALUES ($1,$2,$3,$4,$5,$6,'retrying',1,$7,$8) ON CONFLICT (run_id, assignment_id) DO NOTHING`,
      [l.tenantId, l.runId, l.bookingId, l.assignmentId, l.workerId, l.days, l.nextRetryAt, l.error.slice(0, 80)]);
  }
  async markRetryResult(tx: TxContext, tenantId: string, lineId: string, p: { status: WageLineStatus; payoutId: string | null; grossMinor: bigint; recoveryMinor: bigint; netMinor: bigint; days: number; nextRetryAt: Date | null; error: string | null }): Promise<void> {
    await tx.query(
      `UPDATE labour_wage_run_lines SET status=$3, payout_id=COALESCE($4, payout_id), gross_minor=$5, advance_recovery_minor=$6, net_minor=$7, days_confirmed=GREATEST($8, days_confirmed),
              attempts=attempts+1, next_retry_at=$9, last_error=$10, updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='retrying'`,
      [tenantId, lineId, p.status, p.payoutId, p.grossMinor.toString(), p.recoveryMinor.toString(), p.netMinor.toString(), p.days, p.nextRetryAt, p.error ? p.error.slice(0, 80) : null]);
  }

  // ---- W166 reads ----
  async linesOf(tenantId: string, runId: string): Promise<WageLineRow[]> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${LINE_SELECT} FROM ${LINE_FROM} WHERE l.tenant_id=$1 AND l.run_id=$2 ORDER BY l.created_at, l.id LIMIT 1000`, [tenantId, runId]);
    return r.rows.map(toLine);
  }
  /** Lines still on the retry ladder (any run) and lines named failed in the last 30 days. */
  async openProblems(tenantId: string): Promise<WageLineRow[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${LINE_SELECT} FROM ${LINE_FROM} WHERE l.tenant_id=$1 AND (l.status='retrying' OR (l.status='failed' AND l.updated_at >= now() - interval '30 days'))
        ORDER BY l.next_retry_at NULLS LAST, l.id LIMIT 200`, [tenantId]);
    return r.rows.map(toLine);
  }
  async listRuns(tenantId: string, q: { before?: string; limit: number }): Promise<WageRunRow[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${RUN_COLS} FROM labour_wage_runs WHERE tenant_id=$1 AND ($2::date IS NULL OR run_date < $2::date) ORDER BY run_date DESC LIMIT $3`, [tenantId, q.before ?? null, q.limit]);
    return r.rows.map(toRun);
  }
  /** The manual pay acts (11b, `wage_run_id` NULL) of one IST day — listed in W166 as "manual". */
  async manualPayouts(tenantId: string, runDate: string): Promise<Array<{ id: string; bookingId: string; bookingNo: string | null; workerShortName: string | null; workerPhoneMasked: string; grossMinor: string; advanceRecoveryMinor: string; netMinor: string; status: string; paidBy: string | null; createdAt: string }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT p.id, p.booking_id, b.booking_no, u.full_name, u.phone, (p.base_minor + p.ot_minor)::text AS gross, p.advance_recovery_minor::text AS rec,
              (p.base_minor + p.ot_minor - p.advance_recovery_minor)::text AS net, p.status, p.paid_by, p.created_at
         FROM labour_wage_payouts p JOIN labour_bookings b ON b.id = p.booking_id JOIN users u ON u.id = p.worker_user_id
        WHERE p.tenant_id=$1 AND p.wage_run_id IS NULL AND p.paid_by IS NOT NULL AND p.status <> 'zero'
          AND (p.created_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date ORDER BY p.created_at DESC LIMIT 200`, [tenantId, runDate]);
    return r.rows.map((x: any) => ({ id: x.id, bookingId: x.booking_id, bookingNo: x.booking_no ?? null, workerShortName: shortName(x.full_name), workerPhoneMasked: maskPhone(x.phone ?? ''),
      grossMinor: x.gross, advanceRecoveryMinor: x.rec, netMinor: x.net, status: x.status, paidBy: x.paid_by, createdAt: iso(x.created_at) as string }));
  }
  /** Paid in the last 7 IST days (run lines + manual acts) — the "Paid this week" tile, from the payout rows. */
  async paidLast7Days(tenantId: string): Promise<{ netMinor: string; workerDays: number }> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT COALESCE(sum(p.base_minor + p.ot_minor - p.advance_recovery_minor) FILTER (WHERE p.base_txn_id IS NOT NULL), 0)::text AS net,
              COALESCE(sum(p.days_confirmed) FILTER (WHERE p.base_txn_id IS NOT NULL), 0)::int AS days
         FROM labour_wage_payouts p WHERE p.tenant_id=$1 AND p.created_at >= now() - interval '7 days'`, [tenantId]);
    return { netMinor: r.rows[0]?.net ?? '0', workerDays: r.rows[0]?.days ?? 0 };
  }
}
