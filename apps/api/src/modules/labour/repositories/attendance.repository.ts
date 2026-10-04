// modules/labour/repositories/attendance.repository.ts · all SQL for attendance_records (PRD §31.12).
// tenant_id in EVERY query (Law 1) + RLS (enabled by the auto-RLS pass in 0014; attendance_records owns a
// tenant_id column). The table is PARTITIONED BY RANGE(created_at) — partitions are kept ahead by the
// ensure_partitions() ops job, so a clock-in always lands on a live partition. The table has NO std columns
// (no created_by/updated_at/deleted_at) and NO version column; the one-per-day rule is enforced in-service
// under the booking-assignment write lock (and backstopped by UNIQUE(assignment_id, work_date, created_at)).
//
// PC-56 TENANT-11b · F-6 — THE ROW KEY IS MATCHED EXACTLY. Clock-out and the employer's confirm used to bind the row's
// `created_at` as the JS Date node-pg had parsed it to — MILLISECONDS — against a `timestamptz(6)` column: on every row
// whose microseconds were not 000 the UPDATE matched 0 rows, the service said "already clocked out / already confirmed",
// and a worker could clock in and never out. The day is now read with `created_at::text` (every digit Postgres stored) and
// written back as `$2::timestamptz`, which round-trips exactly (still one partition: the partition key is in the predicate).
// The work date is read with `pgDate`: `toISOString().slice(0, 10)` read a `date` a day early under Asia/Kolkata.
import { Inject, Injectable } from '@nestjs/common';
import { TxContext } from '../../../core/database/unit-of-work';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { pgDate } from '../../../core/database/pg-date';
import { Cursor } from '../domain/cursor';

export interface ClockInRow {
  id: string; tenantId: string; assignmentId: string; workDate: string;
  clockInAt: Date; clockInLat: number; clockInLng: number; clockInDistanceM: number; clockInMethod: string;
  /** PC-56 TENANT-SW-b (0198): an out-of-fence clock-in is RECORDED `needs_review` (the trigger insists), never refused. */
  reviewStatus?: 'none' | 'needs_review';
}

/** A full attendance day row (the lifecycle facts the state machine derives status from). */
export interface AttendanceDay {
  id: string; createdAt: Date; createdAtRaw: string; assignmentId: string; workDate: string;
  clockInAt: Date | null; clockOutAt: Date | null; breakMinutes: number;
  hoursRegular: number | null; hoursOvertime: number; confirmedByEmployer: boolean;
  /** numeric text, for the wage (never a float in money): '8.00', '1.50'. */
  hoursRegularText: string | null; hoursOvertimeText: string;
  /** PC-56 TENANT-SW-b (0198): how the day was recorded and where its review stands. */
  clockInMethod: string; reviewStatus: string;
}

/** PC-56 TENANT-SW-b · W165: a row of the tenant-wide review desk (the worker named by short name + masked phone in the service). */
export interface ReviewRow extends AttendanceDay {
  fenceDistanceM: number | null; vouchedBy: string | null; vouchReason: string | null; vouchedAt: Date | null; confirmedBy: string | null; confirmedAt: Date | null;
  recordedBy: string | null; backfillMediaId: string | null; backfillReason: string | null; wagePayoutId: string | null; bookingId: string; workerId: string;
  bookingNo: string; employerUserId: string; bookingStatus: string; workerFullName: string | null; workerPhone: string; dailyHours: string;
}

/** One row of a worker's work-history (joined to its booking for context). hours are read-only display. */
export interface WorkHistoryRow extends AttendanceDay { bookingId: string; wagePayoutId: string | null; }

const DAY_COLS = `ar.id, ar.created_at, ar.created_at::text AS created_at_raw, ar.assignment_id, ar.work_date, ar.clock_in_at, ar.clock_out_at,
  ar.break_minutes, ar.hours_regular, ar.hours_regular::text AS hours_regular_text, ar.hours_overtime, ar.hours_overtime::text AS hours_overtime_text,
  ar.confirmed_by_employer, ar.clock_in_method, ar.review_status`;
const toDay = (r: any): AttendanceDay => ({
  id: r.id, createdAt: r.created_at, createdAtRaw: r.created_at_raw, assignmentId: r.assignment_id, workDate: pgDate(r.work_date),
  clockInAt: r.clock_in_at, clockOutAt: r.clock_out_at, breakMinutes: Number(r.break_minutes),
  hoursRegular: r.hours_regular === null ? null : Number(r.hours_regular), hoursOvertime: Number(r.hours_overtime),
  confirmedByEmployer: r.confirmed_by_employer, hoursRegularText: r.hours_regular_text ?? null, hoursOvertimeText: r.hours_overtime_text ?? '0',
  clockInMethod: r.clock_in_method ?? 'self', reviewStatus: r.review_status ?? 'none',
});

@Injectable()
export class AttendanceRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Does the assignment already have an attendance row for this work date? (the double-clock-in guard). */
  async findForDay(tx: TxContext, tenantId: string, assignmentId: string, workDate: string): Promise<{ id: string } | null> {
    const r = await tx.query(
      `SELECT id FROM attendance_records WHERE tenant_id=$1 AND assignment_id=$2 AND work_date=$3::date LIMIT 1`,
      [tenantId, assignmentId, workDate]);
    return r.rows[0] ? { id: r.rows[0].id } : null;
  }

  /** Insert the clock-in. distance_m + method are SERVER-computed/SERVER-set — never taken from the client. */
  async insertClockIn(tx: TxContext, row: ClockInRow): Promise<void> {
    await tx.query(
      `INSERT INTO attendance_records (id, tenant_id, assignment_id, work_date, clock_in_at, clock_in_lat,
         clock_in_lng, clock_in_distance_m, clock_in_method, review_status)
       VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10)`,
      [row.id, row.tenantId, row.assignmentId, row.workDate, row.clockInAt, row.clockInLat, row.clockInLng,
       row.clockInDistanceM, row.clockInMethod, row.reviewStatus ?? 'none']);
  }

  /** The full day row for an assignment + date (serialized in-service under the assignment write-lock). */
  async getDay(tx: TxContext, tenantId: string, assignmentId: string, workDate: string): Promise<AttendanceDay | null> {
    const r = await tx.query(
      `SELECT ${DAY_COLS} FROM attendance_records ar WHERE ar.tenant_id=$1 AND ar.assignment_id=$2 AND ar.work_date=$3::date LIMIT 1`,
      [tenantId, assignmentId, workDate]);
    return r.rows[0] ? toDay(r.rows[0]) : null;
  }

  /** Finalise the day: clock_out + SERVER-computed hours/overtime. Guarded by clock_out_at IS NULL; the row key is the
   *  µs TEXT read in this transaction (F-6), so a 0 here is a real mismatch, never a millisecond artefact. */
  async updateClockOut(tx: TxContext, p: { id: string; createdAtRaw: string; tenantId: string; clockOutAt: Date; breakMinutes: number; hoursRegular: number; hoursOvertime: number }): Promise<number> {
    const r = await tx.query(
      `UPDATE attendance_records SET clock_out_at=$4, break_minutes=$5, hours_regular=$6, hours_overtime=$7
       WHERE id=$1 AND created_at=$2::timestamptz AND tenant_id=$3 AND clock_out_at IS NULL`,
      [p.id, p.createdAtRaw, p.tenantId, p.clockOutAt, p.breakMinutes, p.hoursRegular, p.hoursOvertime]);
    return r.rowCount ?? 0;
  }

  /** Employer dual-confirm. Guarded by confirmed_by_employer=false AND clock_out_at NOT NULL (a paper backfill carries no clock times —
   *  its hours are the sheet's); µs row key (F-6). PC-56 TENANT-SW-b: the confirmer is RECORDED, and trg_ar_review refuses the assigned
   *  worker (the dual-confirm law), a needs_review day without a vouch, and a refused day. */
  async updateConfirm(tx: TxContext, p: { id: string; createdAtRaw: string; tenantId: string; confirmedBy: string }): Promise<number> {
    const r = await tx.query(
      `UPDATE attendance_records SET confirmed_by_employer=true, confirmed_by=$4, confirmed_at=now()
       WHERE id=$1 AND created_at=$2::timestamptz AND tenant_id=$3 AND confirmed_by_employer=false AND (clock_out_at IS NOT NULL OR clock_in_method='paper_backfill')`,
      [p.id, p.createdAtRaw, p.tenantId, p.confirmedBy]);
    return r.rowCount ?? 0;
  }

  /* ── PC-56 TENANT-SW-b · B — the tenant-wide review desk (W165) ── */
  /** One row by id (+ who it belongs to), LOCKED. The id alone finds the partition through each partition's PK index. */
  async getForReview(tx: TxContext, tenantId: string, id: string): Promise<(AttendanceDay & { bookingId: string; bookingStatus: string; employerUserId: string; workerUserId: string; recordedBy: string | null }) | null> {
    const r = await tx.query(
      `SELECT ${DAY_COLS}, ba.booking_id, b.status AS booking_status, b.employer_user_id, wp.user_id AS worker_user_id, ar.recorded_by
         FROM attendance_records ar
         JOIN booking_assignments ba ON ba.id = ar.assignment_id AND ba.tenant_id = ar.tenant_id
         JOIN labour_bookings b ON b.id = ba.booking_id AND b.tenant_id = ba.tenant_id
         JOIN worker_profiles wp ON wp.id = ba.worker_id
        WHERE ar.tenant_id=$1 AND ar.id=$2 FOR UPDATE OF ar`, [tenantId, id]);
    const x = r.rows[0];
    return x ? { ...toDay(x), bookingId: x.booking_id, bookingStatus: x.booking_status, employerUserId: x.employer_user_id, workerUserId: x.worker_user_id, recordedBy: x.recorded_by ?? null } : null;
  }
  async updateReview(tx: TxContext, p: { id: string; createdAtRaw: string; tenantId: string; status: 'vouched' | 'refused'; by: string; reason: string }): Promise<number> {
    const r = await tx.query(
      `UPDATE attendance_records SET review_status=$4, vouched_by=$5, vouch_reason=$6, vouched_at=now()
       WHERE id=$1 AND created_at=$2::timestamptz AND tenant_id=$3 AND review_status='needs_review' AND NOT confirmed_by_employer`,
      [p.id, p.createdAtRaw, p.tenantId, p.status, p.by, p.reason]);
    return r.rowCount ?? 0;
  }
  /** A paper day the desk records for a worker: no clock times (none exist), the sheet's hours, the evidence media + reason; needs_review. */
  async insertBackfill(tx: TxContext, row: { id: string; tenantId: string; assignmentId: string; workDate: string; hoursRegular: string; hoursOvertime: string; mediaId: string; reason: string; recordedBy: string }): Promise<void> {
    await tx.query(
      `INSERT INTO attendance_records (id, tenant_id, assignment_id, work_date, hours_regular, hours_overtime, clock_in_method, review_status, recorded_by, backfill_media_id, backfill_reason)
       VALUES ($1,$2,$3,$4::date,$5::numeric,$6::numeric,'paper_backfill','needs_review',$7,$8,$9)`,
      [row.id, row.tenantId, row.assignmentId, row.workDate, row.hoursRegular, row.hoursOvertime, row.recordedBy, row.mediaId, row.reason]);
  }
  /** The CLEAN set — clocked out in-fence by the worker, unreviewed, unconfirmed, on a running/completed job — LOCKED, bounded. */
  async cleanSetForUpdate(tx: TxContext, tenantId: string, opts: { employerUserId: string | null; limit: number }): Promise<Array<AttendanceDay & { bookingId: string; workerUserId: string; workerId: string }>> {
    const r = await tx.query(
      `SELECT ${DAY_COLS}, ba.booking_id, ba.worker_id, wp.user_id AS worker_user_id
         FROM attendance_records ar
         JOIN booking_assignments ba ON ba.id = ar.assignment_id AND ba.tenant_id = ar.tenant_id
         JOIN labour_bookings b ON b.id = ba.booking_id AND b.tenant_id = ba.tenant_id
         JOIN worker_profiles wp ON wp.id = ba.worker_id
        WHERE ar.tenant_id=$1 AND NOT ar.confirmed_by_employer AND ar.clock_out_at IS NOT NULL AND ar.review_status='none' AND ar.clock_in_method='self'
          AND b.status IN ('in_progress','completed') AND b.deleted_at IS NULL AND ($2::uuid IS NULL OR b.employer_user_id = $2::uuid)
        ORDER BY ar.created_at, ar.id LIMIT $3 FOR UPDATE OF ar`, [tenantId, opts.employerUserId, opts.limit]);
    return r.rows.map((x: any) => ({ ...toDay(x), bookingId: x.booking_id, workerUserId: x.worker_user_id, workerId: x.worker_id }));
  }
  /** W165's four tiles — real counts. */
  async reviewTiles(tenantId: string): Promise<{ clean: number; needsReview: number; paperBackfill: number; unconfirmed24h: number; workersToday: number; activeJobs: number }> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT
         count(*) FILTER (WHERE NOT ar.confirmed_by_employer AND ar.clock_out_at IS NOT NULL AND ar.review_status='none' AND ar.clock_in_method='self'
                            AND b.status IN ('in_progress','completed'))::int AS clean,
         count(*) FILTER (WHERE NOT ar.confirmed_by_employer AND ar.review_status='needs_review')::int AS needs_review,
         count(*) FILTER (WHERE NOT ar.confirmed_by_employer AND ar.clock_in_method='paper_backfill' AND ar.review_status <> 'refused')::int AS paper_backfill,
         count(*) FILTER (WHERE NOT ar.confirmed_by_employer AND ar.review_status <> 'refused'
                            AND COALESCE(ar.clock_out_at, CASE WHEN ar.clock_in_method='paper_backfill' THEN ar.created_at END) < now() - interval '24 hours')::int AS unconfirmed_24h,
         count(DISTINCT ba.worker_id) FILTER (WHERE ar.work_date = (now() AT TIME ZONE 'Asia/Kolkata')::date)::int AS workers_today,
         count(DISTINCT ba.booking_id) FILTER (WHERE ar.work_date = (now() AT TIME ZONE 'Asia/Kolkata')::date)::int AS active_jobs
         FROM attendance_records ar
         JOIN booking_assignments ba ON ba.id = ar.assignment_id AND ba.tenant_id = ar.tenant_id
         JOIN labour_bookings b ON b.id = ba.booking_id AND b.tenant_id = ba.tenant_id
        WHERE ar.tenant_id=$1 AND b.deleted_at IS NULL AND ar.created_at >= now() - interval '120 days'`, [tenantId]);
    const x = r.rows[0] ?? {};
    return { clean: x.clean ?? 0, needsReview: x.needs_review ?? 0, paperBackfill: x.paper_backfill ?? 0, unconfirmed24h: x.unconfirmed_24h ?? 0, workersToday: x.workers_today ?? 0, activeJobs: x.active_jobs ?? 0 };
  }
  /** The tenant-wide attendance list (W165 rows), newest first, µs keyset. Bounded to the last 120 days (partition pruning). */
  async listForReview(tenantId: string, q: { status: string; since?: string; cursor?: Cursor; limit: number }): Promise<ReviewRow[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `ar.tenant_id=$1 AND b.deleted_at IS NULL AND ar.created_at >= now() - interval '120 days'`;
    if (q.status === 'clean') where += ` AND NOT ar.confirmed_by_employer AND ar.clock_out_at IS NOT NULL AND ar.review_status='none' AND ar.clock_in_method='self' AND b.status IN ('in_progress','completed')`;
    else if (q.status === 'needs_review') where += ` AND NOT ar.confirmed_by_employer AND ar.review_status='needs_review'`;
    else if (q.status === 'paper_backfill') where += ` AND ar.clock_in_method='paper_backfill'`;
    else if (q.status === 'unconfirmed_24h') where += ` AND NOT ar.confirmed_by_employer AND ar.review_status <> 'refused' AND COALESCE(ar.clock_out_at, CASE WHEN ar.clock_in_method='paper_backfill' THEN ar.created_at END) < now() - interval '24 hours'`;
    else if (q.status === 'confirmed') where += ` AND ar.confirmed_by_employer`;
    else if (q.status === 'refused') where += ` AND ar.review_status='refused'`;
    if (q.since) where += ` AND ar.work_date >= ${p(q.since)}::date`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (ar.created_at < ${cc}::timestamptz OR (ar.created_at = ${cc}::timestamptz AND ar.id < ${ci}::uuid))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${DAY_COLS}, ar.clock_in_distance_m, ar.fence_distance_m, ar.vouched_by, ar.vouch_reason, ar.vouched_at, ar.confirmed_by, ar.confirmed_at, ar.recorded_by,
              ar.backfill_media_id, ar.backfill_reason, ar.wage_payout_id, ba.booking_id, ba.worker_id, b.booking_no, b.employer_user_id, b.status AS booking_status,
              u.full_name, u.phone, b.daily_hours::text AS daily_hours
         FROM attendance_records ar
         JOIN booking_assignments ba ON ba.id = ar.assignment_id AND ba.tenant_id = ar.tenant_id
         JOIN labour_bookings b ON b.id = ba.booking_id AND b.tenant_id = ba.tenant_id
         JOIN worker_profiles wp ON wp.id = ba.worker_id
         JOIN users u ON u.id = wp.user_id
        WHERE ${where} ORDER BY ar.created_at DESC, ar.id DESC LIMIT ${lp}`, params);
    return r.rows.map((x: any) => ({
      ...toDay(x), fenceDistanceM: x.fence_distance_m == null ? null : Number(x.fence_distance_m), vouchedBy: x.vouched_by ?? null, vouchReason: x.vouch_reason ?? null,
      vouchedAt: x.vouched_at ?? null, confirmedBy: x.confirmed_by ?? null, confirmedAt: x.confirmed_at ?? null, recordedBy: x.recorded_by ?? null,
      backfillMediaId: x.backfill_media_id ?? null, backfillReason: x.backfill_reason ?? null, wagePayoutId: x.wage_payout_id ?? null, bookingId: x.booking_id,
      workerId: x.worker_id, bookingNo: x.booking_no, employerUserId: x.employer_user_id, bookingStatus: x.booking_status, workerFullName: x.full_name ?? null,
      workerPhone: x.phone ?? '', dailyHours: x.daily_hours,
    }));
  }

  /** A2 — the CONFIRMED days of an assignment not yet paid, LOCKED (the pay run's input). */
  async confirmedUnpaidForUpdate(tx: TxContext, tenantId: string, assignmentId: string): Promise<AttendanceDay[]> {
    const r = await tx.query(
      `SELECT ${DAY_COLS} FROM attendance_records ar
        WHERE ar.tenant_id=$1 AND ar.assignment_id=$2 AND ar.confirmed_by_employer AND ar.wage_payout_id IS NULL
        ORDER BY ar.work_date, ar.id FOR UPDATE`, [tenantId, assignmentId]);
    return r.rows.map(toDay);
  }
  /** A2 — stamp the paid days with their payout row. Every id must match (the rows were locked above). */
  async stampPayout(tx: TxContext, tenantId: string, attendanceIds: string[], payoutId: string): Promise<number> {
    if (attendanceIds.length === 0) return 0;
    const r = await tx.query(
      `UPDATE attendance_records SET wage_payout_id=$3 WHERE tenant_id=$1 AND id = ANY($2::uuid[]) AND wage_payout_id IS NULL AND confirmed_by_employer`,
      [tenantId, attendanceIds, payoutId]);
    return r.rowCount ?? 0;
  }
  /** Confirmed days on a booking nobody has paid (the cancel guard). */
  async countConfirmedUnpaidForBooking(tx: TxContext, tenantId: string, bookingId: string): Promise<number> {
    const r = await tx.query(
      `SELECT count(*)::int n FROM attendance_records ar JOIN booking_assignments ba ON ba.id = ar.assignment_id AND ba.tenant_id = ar.tenant_id
        WHERE ar.tenant_id=$1 AND ba.booking_id=$2 AND ar.confirmed_by_employer AND ar.wage_payout_id IS NULL`, [tenantId, bookingId]);
    return r.rows[0]?.n ?? 0;
  }
  /** Days clocked out on a booking that the employer has not confirmed yet (a completed booking is not settled past them). */
  async countAwaitingConfirmForBooking(tx: TxContext, tenantId: string, bookingId: string): Promise<number> {
    const r = await tx.query(
      `SELECT count(*)::int n FROM attendance_records ar JOIN booking_assignments ba ON ba.id = ar.assignment_id AND ba.tenant_id = ar.tenant_id
        WHERE ar.tenant_id=$1 AND ba.booking_id=$2 AND ar.clock_out_at IS NOT NULL AND NOT ar.confirmed_by_employer`, [tenantId, bookingId]);
    return r.rows[0]?.n ?? 0;
  }
  /** Per-assignment attendance facts for the roster ("confirmed days", "awaiting confirm"). */
  async rosterFacts(tenantId: string, assignmentIds: string[]): Promise<Map<string, { confirmed: number; awaitingConfirm: number; clockedIn: number; paidDays: number }>> {
    const out = new Map<string, { confirmed: number; awaitingConfirm: number; clockedIn: number; paidDays: number }>();
    if (assignmentIds.length === 0) return out;
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT assignment_id,
              count(*) FILTER (WHERE confirmed_by_employer)::int AS confirmed,
              count(*) FILTER (WHERE clock_out_at IS NOT NULL AND NOT confirmed_by_employer)::int AS awaiting,
              count(*) FILTER (WHERE clock_out_at IS NULL)::int AS clocked_in,
              count(*) FILTER (WHERE wage_payout_id IS NOT NULL)::int AS paid_days
         FROM attendance_records WHERE tenant_id=$1 AND assignment_id = ANY($2::uuid[]) GROUP BY assignment_id`, [tenantId, assignmentIds]);
    for (const x of r.rows as any[]) out.set(x.assignment_id, { confirmed: x.confirmed, awaitingConfirm: x.awaiting, clockedIn: x.clocked_in, paidDays: x.paid_days });
    return out;
  }
  /** The day rows of one assignment, newest first (the detail screen's per-day confirm list). */
  async daysForAssignment(tenantId: string, assignmentId: string, limit = 62): Promise<Array<AttendanceDay & { wagePayoutId: string | null }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${DAY_COLS}, ar.wage_payout_id FROM attendance_records ar WHERE ar.tenant_id=$1 AND ar.assignment_id=$2 ORDER BY ar.work_date DESC LIMIT $3`,
      [tenantId, assignmentId, limit]);
    return r.rows.map((x: any) => ({ ...toDay(x), wagePayoutId: x.wage_payout_id ?? null }));
  }

  /** A worker's work-history (newest first), keyset on (created_at,id) — µs (F-25). Joined to the assignment to filter by
   *  worker + expose the booking id. Replica read (CQRS); never OFFSET. */
  async listForWorker(tenantId: string, workerId: string, opts: { cursor?: Cursor; limit: number }): Promise<WorkHistoryRow[]> {
    const params: unknown[] = [tenantId, workerId];
    let where = `ar.tenant_id=$1 AND ba.worker_id=$2`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (opts.cursor) { const cc = p(opts.cursor.c), ci = p(opts.cursor.id); where += ` AND (ar.created_at < ${cc}::timestamptz OR (ar.created_at = ${cc}::timestamptz AND ar.id < ${ci}))`; }
    const lp = p(opts.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${DAY_COLS}, ba.booking_id, ar.wage_payout_id
       FROM attendance_records ar
       JOIN booking_assignments ba ON ba.id = ar.assignment_id AND ba.tenant_id = ar.tenant_id
       WHERE ${where} ORDER BY ar.created_at DESC, ar.id DESC LIMIT ${lp}`, params);
    return r.rows.map((x: any) => ({ ...toDay(x), bookingId: x.booking_id, wagePayoutId: x.wage_payout_id }));
  }

  /** A11 — the tenant-wide attendance facts for the console KPIs (India "today"). */
  async summaryFacts(tenantId: string, today: string): Promise<{ inProgressToday: number; clockedInNow: number }> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT
         (SELECT count(*)::int FROM labour_bookings b WHERE b.tenant_id=$1 AND b.status='in_progress' AND b.deleted_at IS NULL
             AND b.start_date <= $2::date AND b.end_date >= $2::date) AS in_progress_today,
         (SELECT count(DISTINCT ar.assignment_id)::int FROM attendance_records ar WHERE ar.tenant_id=$1 AND ar.work_date=$2::date
             AND ar.clock_in_at IS NOT NULL AND ar.clock_out_at IS NULL) AS clocked_in_now`, [tenantId, today]);
    return { inProgressToday: r.rows[0]?.in_progress_today ?? 0, clockedInNow: r.rows[0]?.clocked_in_now ?? 0 };
  }
  /** A11 — days clocked out and awaiting the employer's confirm: the bookings, the days, and the hours they hold. */
  async awaitingConfirm(tenantId: string): Promise<Array<{ bookingId: string; assignmentId: string; wageKind: string; rateMinor: string; dailyHours: string; multiplier: string; hoursRegular: string | null; hoursOvertime: string }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ba.booking_id, ar.assignment_id, b.wage_kind, ba.wage_minor::text AS rate_minor, b.daily_hours::text AS daily_hours,
              b.overtime_rate_multiplier::text AS multiplier, ar.hours_regular::text AS hours_regular, ar.hours_overtime::text AS hours_overtime
         FROM attendance_records ar
         JOIN booking_assignments ba ON ba.id = ar.assignment_id AND ba.tenant_id = ar.tenant_id
         JOIN labour_bookings b ON b.id = ba.booking_id AND b.tenant_id = ba.tenant_id
        WHERE ar.tenant_id=$1 AND ar.clock_out_at IS NOT NULL AND NOT ar.confirmed_by_employer
          AND b.status IN ('in_progress','completed') AND b.deleted_at IS NULL
        LIMIT 5000`, [tenantId]);
    return r.rows.map((x: any) => ({ bookingId: x.booking_id, assignmentId: x.assignment_id, wageKind: x.wage_kind, rateMinor: x.rate_minor, dailyHours: x.daily_hours, multiplier: x.multiplier, hoursRegular: x.hours_regular, hoursOvertime: x.hours_overtime }));
  }
}
