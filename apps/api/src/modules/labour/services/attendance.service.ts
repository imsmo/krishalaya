// modules/labour/services/attendance.service.ts · the worker clock-in (geo-fenced attendance, PRD §31.12).
// THE FENCE IS SERVER-SIDE: the device sends only its raw GPS fix; the server re-resolves the booking's farm
// coordinates, computes the great-circle distance itself (domain/geo.ts), and REFUSES a clock-in farther than
// ATTENDANCE_FENCE_M — the client cannot forge proximity. Ownership is re-resolved from the token (the caller's
// own worker profile, anti-IDOR); a worker may only clock in on an assignment that is theirs AND 'accepted'.
// One ACID tx (UoW) under the assignment write-lock, idempotent on the caller's key (Law 3), one row per
// assignment per day (backstopped by attendance_records' UNIQUE(assignment_id, work_date, created_at)), event
// drained to the outbox in-tx (Law 4). No money moves here (wages settle later via payWages).
//
// P0-9 adds the rest of the attendance lifecycle on top of clock-in:
//   • clockOut    — WORKER finalises the day; the SERVER stamps the time + computes hours/overtime (hours.ts).
//   • confirmDay  — EMPLOYER dual-confirms a clocked-out day (booking owner OR a booking.manage admin, Law 11).
//   • workHistory — the worker's OWN attendance history (keyset, replica). Money still settles only in the ledger.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { distanceMeters, ATTENDANCE_FENCE_M } from '../domain/geo';
import { computeHours } from '../domain/hours';
import { deriveStatus, assertTransition } from '../domain/attendance.state';
import { LabourEventType } from '../domain/labour.events';
import { BookingAssignmentRepository } from '../repositories/booking-assignment.repository';
import { WorkerProfileRepository } from '../repositories/worker-profile.repository';
import { LabourBookingRepository } from '../repositories/labour-booking.repository';
import { AttendanceRepository } from '../repositories/attendance.repository';
import {
  AssignmentNotFoundError, LabourForbiddenError,
  BookingNotFoundError, AssignmentNotAcceptedError, OutOfFenceError, AlreadyClockedInError,
  NotClockedInError, AlreadyClockedOutError, ClockOutBeforeClockInError, NotClockedOutError, AlreadyConfirmedError,
  AttendanceRowMismatchError, BookingSettledError,
} from '../domain/labour.errors';
import { indiaDay } from '../domain/display';
import { Cursor, encodeCursor } from '../domain/cursor';

// PC-56 TENANT-11b: the work date is the INDIA calendar day of the clock-in (a 05:00 IST clock-in was stamped YESTERDAY by
// `toISOString().slice(0,10)`, the UTC day), and the attendance row is matched on its µs `created_at` TEXT (F-6) — a write
// that then matches 0 rows is a named mismatch, never "lost the race".
const workDateOf = (d: Date) => indiaDay(d);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isYmd = (s: string) => DATE_RE.test(s);

/** The actor for an EMPLOYER-side confirm: the caller's userId + whether they oversee labour (booking.manage / labour.desk). */
export interface ConfirmActor { userId: string; canManage: boolean; canDesk?: boolean; }

@Injectable()
export class AttendanceService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly assignments: BookingAssignmentRepository,
    private readonly workers: WorkerProfileRepository,
    private readonly bookings: LabourBookingRepository,
    private readonly attendance: AttendanceRepository,
    private readonly audit: AuditWriter,
  ) {}

  /** WORKER clocks in for today on their OWN accepted assignment, proving they are within the farm fence. */
  async clockIn(tenantId: string, userId: string, assignmentId: string, fix: { lat: number; lng: number }, idemKey: string) {
    return this.idem.remember(idemKey, userId, 'labour.attendance.clock_in', () =>
      timed(this.metrics, 'labour.attendance.clock_in', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const assignment = await this.assignments.getForUpdate(tx, tenantId, assignmentId);   // lock the assignment row
          if (!assignment) throw new AssignmentNotFoundError(assignmentId);
          const mine = await this.workers.findByUser(tenantId, userId, tx);                     // the caller's OWN profile (anti-IDOR)
          if (!mine || mine.id !== assignment.workerId) throw new LabourForbiddenError('only the assigned worker may clock in');
          if (assignment.status !== 'accepted') throw new AssignmentNotAcceptedError(assignment.status);

          const booking = await this.bookings.getById(tenantId, assignment.bookingId, tx);
          if (!booking) throw new BookingNotFoundError(assignment.bookingId);
          // PC-56 TENANT-11b: a day is worked on a STARTED job — the roster confirmed and the wages escrowed first (A3).
          if (booking.status !== 'in_progress') throw new BookingSettledError(booking.status);
          const b = booking.toProps();
          const distanceM = distanceMeters(fix.lat, fix.lng, b.farmLat, b.farmLng);             // SERVER-computed fence proof
          if (distanceM > ATTENDANCE_FENCE_M) throw new OutOfFenceError(distanceM, ATTENDANCE_FENCE_M);

          const now = new Date();
          const workDate = workDateOf(now);
          if (await this.attendance.findForDay(tx, tenantId, assignmentId, workDate)) throw new AlreadyClockedInError();

          const id = uuidv7();
          await this.attendance.insertClockIn(tx, {
            id, tenantId, assignmentId, workDate, clockInAt: now,
            clockInLat: fix.lat, clockInLng: fix.lng, clockInDistanceM: distanceM, clockInMethod: 'self',
          });
          await this.outbox.write(tx, {
            tenantId, aggregateType: 'attendance_record', aggregateId: id, eventType: LabourEventType.AttendanceClockedIn,
            payload: { v: 1, attendanceId: id, assignmentId, bookingId: assignment.bookingId, workerId: mine.id, workDate, distanceM },
          });
          return { id, assignmentId, bookingId: assignment.bookingId, workDate, clockInAt: now.toISOString(), distanceM, method: 'self' };
        }, { userId })));
  }

  /** WORKER clocks out of TODAY's open attendance on their OWN accepted assignment. The SERVER stamps the
   *  time (clock-skew/tamper-proof) and computes regular + overtime hours (hours.ts). The worker may only
   *  declare the unpaid break they took. Idempotent on the caller's key + guarded by clock_out_at IS NULL. */
  async clockOut(tenantId: string, userId: string, assignmentId: string, input: { breakMinutes: number }, idemKey: string) {
    return this.idem.remember(idemKey, userId, 'labour.attendance.clock_out', () =>
      timed(this.metrics, 'labour.attendance.clock_out', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const assignment = await this.assignments.getForUpdate(tx, tenantId, assignmentId);   // serialize on the assignment
          if (!assignment) throw new AssignmentNotFoundError(assignmentId);
          const mine = await this.workers.findByUser(tenantId, userId, tx);                     // caller's OWN profile (anti-IDOR)
          if (!mine || mine.id !== assignment.workerId) throw new LabourForbiddenError('only the assigned worker may clock out');

          const now = new Date();
          const workDate = workDateOf(now);
          const day = await this.attendance.getDay(tx, tenantId, assignmentId, workDate);
          if (!day || !day.clockInAt) throw new NotClockedInError();
          const status = deriveStatus(day);
          if (status === 'clocked_out' || status === 'confirmed') throw new AlreadyClockedOutError();
          assertTransition(status, 'clocked_out');                                              // clocked_in → clocked_out
          if (now.getTime() <= day.clockInAt.getTime()) throw new ClockOutBeforeClockInError(); // never negative hours

          const hrs = computeHours({ clockInAt: day.clockInAt, clockOutAt: now, breakMinutes: input.breakMinutes });
          const changed = await this.attendance.updateClockOut(tx, {
            id: day.id, createdAtRaw: day.createdAtRaw, tenantId, clockOutAt: now,
            breakMinutes: input.breakMinutes, hoursRegular: hrs.hoursRegular, hoursOvertime: hrs.hoursOvertime,
          });
          // The row was read in THIS transaction under the assignment lock, so 0 is not a race — it is a named defect.
          if (changed !== 1) throw new AttendanceRowMismatchError(day.id, 'clocked out');
          await this.outbox.write(tx, {
            tenantId, aggregateType: 'attendance_record', aggregateId: day.id, eventType: LabourEventType.AttendanceClockedOut,
            payload: { v: 1, attendanceId: day.id, assignmentId, bookingId: assignment.bookingId, workerId: mine.id, workDate, hoursRegular: hrs.hoursRegular, hoursOvertime: hrs.hoursOvertime, workedMinutes: hrs.workedMinutes },
          });
          return { id: day.id, assignmentId, bookingId: assignment.bookingId, workDate, status: 'clocked_out', clockOutAt: now.toISOString(), hoursRegular: hrs.hoursRegular, hoursOvertime: hrs.hoursOvertime };
        }, { userId })));
  }

  /** EMPLOYER dual-confirms a worker's clocked-out day. Only the booking's employer (or a booking.manage admin,
   *  Law 11) may confirm. A day must be clocked_out first (hours finalised); confirming is terminal + idempotent.
   *  No money moves — confirmation is the gate the wage settlement (payWages, ledger) reads. */
  async confirmDay(tenantId: string, actor: ConfirmActor, assignmentId: string, workDate: string, idemKey: string, ip: string | null) {
    if (!isYmd(workDate)) throw new NotClockedInError();
    return this.idem.remember(idemKey, actor.userId, 'labour.attendance.confirm', () =>
      timed(this.metrics, 'labour.attendance.confirm', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const assignment = await this.assignments.getForUpdate(tx, tenantId, assignmentId);   // serialize on the assignment
          if (!assignment) throw new AssignmentNotFoundError(assignmentId);
          const booking = await this.bookings.getById(tenantId, assignment.bookingId, tx);
          if (!booking) throw new BookingNotFoundError(assignment.bookingId);
          // authz: the booking's employer, or the tenant's labour oversight (booking.manage / labour.desk). Others see 404.
          if (booking.employerUserId !== actor.userId && !actor.canManage && !actor.canDesk) throw new AssignmentNotFoundError(assignmentId);
          // The money can still move only while the job runs or awaits its pay run (not once paid out or cancelled).
          if (booking.status !== 'in_progress' && booking.status !== 'completed') throw new BookingSettledError(booking.status);

          const day = await this.attendance.getDay(tx, tenantId, assignmentId, workDate);
          if (!day || !day.clockInAt) throw new NotClockedInError();
          const status = deriveStatus(day);
          if (status === 'confirmed') throw new AlreadyConfirmedError();
          if (status !== 'clocked_out') throw new NotClockedOutError(status);                    // can't confirm an open day
          assertTransition(status, 'confirmed');

          const changed = await this.attendance.updateConfirm(tx, { id: day.id, createdAtRaw: day.createdAtRaw, tenantId });
          if (changed !== 1) throw new AttendanceRowMismatchError(day.id, 'confirmed');
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'labour.attendance_confirmed', entityType: 'attendance_record', entityId: day.id,
            oldValue: { status: 'clocked_out' }, newValue: { status: 'confirmed', bookingId: assignment.bookingId, assignmentId, workDate, hoursRegular: day.hoursRegular, hoursOvertime: day.hoursOvertime }, ip });
          await this.outbox.write(tx, {
            tenantId, aggregateType: 'attendance_record', aggregateId: day.id, eventType: LabourEventType.AttendanceConfirmed,
            payload: { v: 1, attendanceId: day.id, assignmentId, bookingId: assignment.bookingId, workerId: assignment.workerId, workDate, confirmedBy: actor.userId },
          });
          return { id: day.id, assignmentId, bookingId: assignment.bookingId, workDate, status: 'confirmed', hoursRegular: day.hoursRegular, hoursOvertime: day.hoursOvertime };
        }, { userId: actor.userId })));
  }

  /** The caller's OWN work-history (attendance days, newest first). Resolves the worker profile from the token
   *  (anti-IDOR) — a caller with no worker profile gets an empty page, never another worker's history. */
  async workHistory(tenantId: string, userId: string, q: { cursor?: Cursor; limit: number }) {
    const mine = await this.workers.findByUser(tenantId, userId);
    if (!mine) return { items: [], nextCursor: null };
    const rows = await this.attendance.listForWorker(tenantId, mine.id, q);
    const items = rows.map((r) => ({
      id: r.id, assignmentId: r.assignmentId, bookingId: r.bookingId, workDate: r.workDate,
      clockInAt: r.clockInAt ? r.clockInAt.toISOString() : null, clockOutAt: r.clockOutAt ? r.clockOutAt.toISOString() : null,
      breakMinutes: r.breakMinutes, hoursRegular: r.hoursRegular, hoursOvertime: r.hoursOvertime,
      status: deriveStatus(r), confirmedByEmployer: r.confirmedByEmployer, paid: r.wagePayoutId !== null, createdAt: r.createdAt.toISOString(),
    }));
    const last = rows[rows.length - 1];
    return { items, nextCursor: items.length === q.limit && last ? encodeCursor(last.createdAtRaw, last.id) : null };
  }
}
