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
}

/** A full attendance day row (the lifecycle facts the state machine derives status from). */
export interface AttendanceDay {
  id: string; createdAt: Date; createdAtRaw: string; assignmentId: string; workDate: string;
  clockInAt: Date | null; clockOutAt: Date | null; breakMinutes: number;
  hoursRegular: number | null; hoursOvertime: number; confirmedByEmployer: boolean;
  /** numeric text, for the wage (never a float in money): '8.00', '1.50'. */
  hoursRegularText: string | null; hoursOvertimeText: string;
}

/** One row of a worker's work-history (joined to its booking for context). hours are read-only display. */
export interface WorkHistoryRow extends AttendanceDay { bookingId: string; wagePayoutId: string | null; }

const DAY_COLS = `ar.id, ar.created_at, ar.created_at::text AS created_at_raw, ar.assignment_id, ar.work_date, ar.clock_in_at, ar.clock_out_at,
  ar.break_minutes, ar.hours_regular, ar.hours_regular::text AS hours_regular_text, ar.hours_overtime, ar.hours_overtime::text AS hours_overtime_text,
  ar.confirmed_by_employer`;
const toDay = (r: any): AttendanceDay => ({
  id: r.id, createdAt: r.created_at, createdAtRaw: r.created_at_raw, assignmentId: r.assignment_id, workDate: pgDate(r.work_date),
  clockInAt: r.clock_in_at, clockOutAt: r.clock_out_at, breakMinutes: Number(r.break_minutes),
  hoursRegular: r.hours_regular === null ? null : Number(r.hours_regular), hoursOvertime: Number(r.hours_overtime),
  confirmedByEmployer: r.confirmed_by_employer, hoursRegularText: r.hours_regular_text ?? null, hoursOvertimeText: r.hours_overtime_text ?? '0',
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
         clock_in_lng, clock_in_distance_m, clock_in_method)
       VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9)`,
      [row.id, row.tenantId, row.assignmentId, row.workDate, row.clockInAt, row.clockInLat, row.clockInLng,
       row.clockInDistanceM, row.clockInMethod]);
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

  /** Employer dual-confirm. Guarded by confirmed_by_employer=false AND clock_out_at NOT NULL; µs row key (F-6). */
  async updateConfirm(tx: TxContext, p: { id: string; createdAtRaw: string; tenantId: string }): Promise<number> {
    const r = await tx.query(
      `UPDATE attendance_records SET confirmed_by_employer=true
       WHERE id=$1 AND created_at=$2::timestamptz AND tenant_id=$3 AND confirmed_by_employer=false AND clock_out_at IS NOT NULL`,
      [p.id, p.createdAtRaw, p.tenantId]);
    return r.rowCount ?? 0;
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
