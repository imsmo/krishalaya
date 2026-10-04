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
import { AttendanceRepository, AttendanceDay } from '../repositories/attendance.repository';
import {
  AssignmentNotFoundError, LabourForbiddenError,
  BookingNotFoundError, AssignmentNotAcceptedError, OutOfFenceError, AlreadyClockedInError,
  NotClockedInError, AlreadyClockedOutError, ClockOutBeforeClockInError, NotClockedOutError, AlreadyConfirmedError,
  AttendanceRowMismatchError, BookingSettledError, AttendanceRecordNotFoundError, AttendanceReasonRequiredError, LabourRefusedError, namedLabourRefusal,
} from '../domain/labour.errors';
import { indiaDay, maskPhone, shortName } from '../domain/display';
import { Cursor, encodeCursor } from '../domain/cursor';

// PC-56 TENANT-11b: the work date is the INDIA calendar day of the clock-in (a 05:00 IST clock-in was stamped YESTERDAY by
// `toISOString().slice(0,10)`, the UTC day), and the attendance row is matched on its µs `created_at` TEXT (F-6) — a write
// that then matches 0 rows is a named mismatch, never "lost the race".
const workDateOf = (d: Date) => indiaDay(d);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isYmd = (s: string) => DATE_RE.test(s);

/** The actor for an EMPLOYER-side confirm: the caller's userId + whether they oversee labour (booking.manage / labour.desk). */
export interface ConfirmActor { userId: string; canManage: boolean; canDesk?: boolean; canBook?: boolean }

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
          // PC-56 TENANT-SW-b · F-12 (founder: RECORDED AND REVIEWED). A clock-in beyond the fence is no longer refused — rural GPS drifts,
          // plots have edges ("a fence miss is a question, never an accusation", W165). It is recorded `needs_review`; it can be confirmed
          // only after someone other than the worker vouches for it (trg_ar_review), so no wage accrues on it until then.
          const outOfFence = distanceM > ATTENDANCE_FENCE_M;

          const now = new Date();
          const workDate = workDateOf(now);
          if (await this.attendance.findForDay(tx, tenantId, assignmentId, workDate)) throw new AlreadyClockedInError();

          const id = uuidv7();
          await this.attendance.insertClockIn(tx, {
            id, tenantId, assignmentId, workDate, clockInAt: now,
            clockInLat: fix.lat, clockInLng: fix.lng, clockInDistanceM: distanceM, clockInMethod: 'self', reviewStatus: outOfFence ? 'needs_review' : 'none',
          });
          await this.outbox.write(tx, {
            tenantId, aggregateType: 'attendance_record', aggregateId: id, eventType: LabourEventType.AttendanceClockedIn,
            payload: { v: 1, attendanceId: id, assignmentId, bookingId: assignment.bookingId, workerId: mine.id, workDate, distanceM, outOfFence },
          });
          return { id, assignmentId, bookingId: assignment.bookingId, workDate, clockInAt: now.toISOString(), distanceM, method: 'self', fenceM: ATTENDANCE_FENCE_M,
            outOfFence, reviewStatus: outOfFence ? 'needs_review' : 'none' };
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
          if (!day || (!day.clockInAt && day.clockInMethod !== 'paper_backfill')) throw new NotClockedInError();
          return this.confirmRowInTx(tx, tenantId, actor.userId, { ...day, bookingId: assignment.bookingId, workerId: assignment.workerId }, ip, null, false);
        }, { userId: actor.userId })));
  }

  /** The confirm itself (one day). PC-56 TENANT-SW-b: the confirmer is recorded; the DATABASE (trg_ar_review) refuses the assigned worker
   *  (dual-confirm law — the labour desk path included, which never compared them), a needs_review day without a vouch, a refused day. */
  private async confirmRowInTx(tx: TxContext, tenantId: string, actorUserId: string, day: AttendanceDay & { bookingId: string; workerId: string }, ip: string | null, reason: string | null, bulk: boolean) {
    const status = deriveStatus(day);
    if (status === 'confirmed') throw new AlreadyConfirmedError();
    if (status !== 'clocked_out') throw new NotClockedOutError(status);                    // can't confirm an open day
    assertTransition(status, 'confirmed');
    let changed: number;
    try { changed = await this.attendance.updateConfirm(tx, { id: day.id, createdAtRaw: day.createdAtRaw, tenantId, confirmedBy: actorUserId }); }
    catch (e) { throw namedLabourRefusal(e); }
    if (changed !== 1) throw new AttendanceRowMismatchError(day.id, 'confirmed');
    await this.audit.write(tx, { tenantId, actorUserId, action: 'labour.attendance_confirmed', entityType: 'attendance_record', entityId: day.id, reason,
      oldValue: { status: 'clocked_out' }, newValue: { status: 'confirmed', bookingId: day.bookingId, assignmentId: day.assignmentId, workDate: day.workDate,
        hoursRegular: day.hoursRegular, hoursOvertime: day.hoursOvertime, method: day.clockInMethod, reviewStatus: day.reviewStatus, bulk }, ip });
    await this.outbox.write(tx, {
      tenantId, aggregateType: 'attendance_record', aggregateId: day.id, eventType: LabourEventType.AttendanceConfirmed,
      payload: { v: 1, attendanceId: day.id, assignmentId: day.assignmentId, bookingId: day.bookingId, workerId: day.workerId, workDate: day.workDate, confirmedBy: actorUserId },
    });
    return { id: day.id, assignmentId: day.assignmentId, bookingId: day.bookingId, workDate: day.workDate, status: 'confirmed', hoursRegular: day.hoursRegular, hoursOvertime: day.hoursOvertime };
  }

  /* ─────────────────────────── PC-56 TENANT-SW-b · B — THE REVIEW DESK (W165) ─────────────────────────── */

  /** May this actor act on this day? The booking's employer, or the tenant's labour oversight (labour.desk / booking.manage). */
  private mayReview(actor: ConfirmActor, employerUserId: string): boolean { return employerUserId === actor.userId || actor.canManage || !!actor.canDesk; }
  private assertOversight(actor: ConfirmActor) { if (!actor.canManage && !actor.canDesk) throw new LabourForbiddenError('requires labour.desk or booking.manage'); }

  /** W165 tiles — real counts. */
  async reviewSummary(tenantId: string, actor: ConfirmActor) {
    this.assertOversight(actor);
    return { ...(await this.attendance.reviewTiles(tenantId)), fenceM: ATTENDANCE_FENCE_M, offlineDeviceStore: { built: false, reason: 'mobile_offline_clock_store_not_built' } };
  }

  /** The tenant-wide list (desk / manage). Workers are named by short name + the 1b MASKED phone — never the number. µs cursor. */
  async reviewList(tenantId: string, actor: ConfirmActor, q: { status: string; since?: string; cursor?: Cursor; limit: number }) {
    this.assertOversight(actor);
    const rows = await this.attendance.listForReview(tenantId, q);
    const items = rows.map((r) => ({
      id: r.id, assignmentId: r.assignmentId, bookingId: r.bookingId, bookingNo: r.bookingNo, workDate: r.workDate,
      workerId: r.workerId, workerShortName: shortName(r.workerFullName), workerPhoneMasked: maskPhone(r.workerPhone),
      clockInAt: r.clockInAt ? r.clockInAt.toISOString() : null, clockOutAt: r.clockOutAt ? r.clockOutAt.toISOString() : null,
      fenceDistanceM: r.fenceDistanceM, outOfFence: r.fenceDistanceM !== null && r.fenceDistanceM > ATTENDANCE_FENCE_M,
      hoursRegular: r.hoursRegularText, hoursOvertime: r.hoursOvertimeText, method: r.clockInMethod, reviewStatus: r.reviewStatus,
      status: deriveStatus(r), confirmed: r.confirmedByEmployer, confirmedBy: r.confirmedBy, confirmedAt: r.confirmedAt ? new Date(r.confirmedAt).toISOString() : null,
      vouchedBy: r.vouchedBy, vouchReason: r.vouchReason, recordedBy: r.recordedBy, backfillMediaId: r.backfillMediaId, backfillReason: r.backfillReason,
      paid: r.wagePayoutId !== null, viewerIsWorker: false, viewerIsEmployer: r.employerUserId === actor.userId,
    }));
    const last = rows[rows.length - 1];
    return { items, nextCursor: rows.length === q.limit && last ? encodeCursor(last.createdAtRaw, last.id) : null };
  }

  private async reviewTarget(tx: TxContext, tenantId: string, actor: ConfirmActor, id: string) {
    const row = await this.attendance.getForReview(tx, tenantId, id);
    if (!row || !this.mayReview(actor, row.employerUserId)) throw new AttendanceRecordNotFoundError(id);
    if (row.bookingStatus !== 'in_progress' && row.bookingStatus !== 'completed') throw new BookingSettledError(row.bookingStatus);
    return row;
  }

  /** Vouch (or refuse) a needs_review day, with a reason (10–500). The DATABASE refuses a vouch by the worker, and by a backfill's recorder. */
  async review(tenantId: string, actor: ConfirmActor, id: string, verdict: 'vouched' | 'refused', reasonRaw: string, ip: string | null) {
    const reason = (reasonRaw ?? '').trim();
    if (reason.length < 10 || reason.length > 500) throw new AttendanceReasonRequiredError(verdict === 'vouched' ? 'vouch for a day' : 'refuse a day');
    return this.uow.run(tenantId, async (tx) => {
      const row = await this.reviewTarget(tx, tenantId, actor, id);
      let n: number;
      try { n = await this.attendance.updateReview(tx, { id: row.id, createdAtRaw: row.createdAtRaw, tenantId, status: verdict, by: actor.userId, reason }); }
      catch (e) { throw namedLabourRefusal(e); }
      if (n !== 1) throw new LabourRefusedError('ATTENDANCE_REVIEW_MOVE', 'This day is not waiting for review.', 409, { reviewStatus: row.reviewStatus });
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: verdict === 'vouched' ? 'labour.attendance_vouched' : 'labour.attendance_refused',
        entityType: 'attendance_record', entityId: row.id, reason, ip, oldValue: { reviewStatus: 'needs_review' },
        newValue: { reviewStatus: verdict, bookingId: row.bookingId, assignmentId: row.assignmentId, workDate: row.workDate, method: row.clockInMethod } });
      return { id: row.id, reviewStatus: verdict, workDate: row.workDate };
    }, { userId: actor.userId });
  }

  /** Confirm one day by its id (the review desk's act). Idempotent on the caller's key. */
  async confirmById(tenantId: string, actor: ConfirmActor, id: string, reason: string | null, idemKey: string, ip: string | null) {
    return this.idem.remember(idemKey, actor.userId, 'labour.attendance.confirm', () =>
      this.uow.run(tenantId, async (tx) => {
        const row = await this.reviewTarget(tx, tenantId, actor, id);
        const assignment = await this.assignments.getForUpdate(tx, tenantId, row.assignmentId);
        if (!assignment) throw new AssignmentNotFoundError(row.assignmentId);
        return this.confirmRowInTx(tx, tenantId, actor.userId, { ...row, workerId: assignment.workerId }, ip, reason, false);
      }, { userId: actor.userId }));
  }

  /**
   * "Confirm all clean records" (W165): ONE keyed act over the clean set — clocked out in-fence by the worker, unreviewed, unconfirmed — each
   * day confirmed individually (its own audit row and outbox event) in ONE transaction; the count is returned. The actor's own days are
   * skipped (the database would refuse them — the dual-confirm law) and counted. An employer confirms their own bookings; the desk all.
   */
  async confirmAllClean(tenantId: string, actor: ConfirmActor, reason: string | null, idemKey: string, ip: string | null) {
    if (!actor.canManage && !actor.canDesk && !actor.canBook) throw new LabourForbiddenError('requires labour.desk, booking.manage or worker.book');
    return this.idem.remember(idemKey, actor.userId, 'labour.attendance.confirm_clean', () =>
      this.uow.run(tenantId, async (tx) => {
        const set = await this.attendance.cleanSetForUpdate(tx, tenantId, { employerUserId: actor.canManage || actor.canDesk ? null : actor.userId, limit: 500 });
        const confirmed: string[] = []; let skippedOwn = 0;
        for (const d of set) {
          if (d.workerUserId === actor.userId) { skippedOwn++; continue; }
          await this.confirmRowInTx(tx, tenantId, actor.userId, d, ip, reason, true);
          confirmed.push(d.id);
        }
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'labour.attendance_confirmed_clean', entityType: 'attendance_batch', entityId: null, reason, ip,
          oldValue: { clean: set.length }, newValue: { confirmed: confirmed.length, skippedOwn, ids: confirmed.slice(0, 200) } });
        return { confirmed: confirmed.length, skippedOwn, considered: set.length, ids: confirmed };
      }, { userId: actor.userId }));
  }

  /** Paper backfill (W165 `paper_backfill`): the DESK records a day for a worker from a signed sheet — evidence media + reason (10–500) +
   *  the sheet's hours. Recorded needs_review; it is confirmed only after someone OTHER than its recorder vouches (trg_ar_review). */
  async backfill(tenantId: string, actor: ConfirmActor, input: { assignmentId: string; workDate: string; hoursRegular: number; hoursOvertime: number; mediaId: string; reason: string }, idemKey: string, ip: string | null) {
    this.assertOversight(actor);
    const reason = (input.reason ?? '').trim();
    if (reason.length < 10 || reason.length > 500) throw new AttendanceReasonRequiredError('record a paper day');
    if (!isYmd(input.workDate) || input.workDate > indiaDay(new Date())) throw new LabourRefusedError('ATTENDANCE_BACKFILL_DATE', 'A paper day is a past or today\'s date.', 422);
    return this.idem.remember(idemKey, actor.userId, 'labour.attendance.backfill', () =>
      this.uow.run(tenantId, async (tx) => {
        const assignment = await this.assignments.getForUpdate(tx, tenantId, input.assignmentId);
        if (!assignment) throw new AssignmentNotFoundError(input.assignmentId);
        if (assignment.status !== 'accepted') throw new AssignmentNotAcceptedError(assignment.status);
        const booking = await this.bookings.getById(tenantId, assignment.bookingId, tx);
        if (!booking) throw new BookingNotFoundError(assignment.bookingId);
        if (booking.status !== 'in_progress' && booking.status !== 'completed') throw new BookingSettledError(booking.status);
        const b = booking.toProps();
        if (input.workDate < b.startDate || input.workDate > b.endDate) throw new LabourRefusedError('ATTENDANCE_BACKFILL_DATE', 'A paper day falls within the job\'s dates.', 422, { startDate: b.startDate, endDate: b.endDate });
        if (await this.attendance.findForDay(tx, tenantId, input.assignmentId, input.workDate)) throw new AlreadyClockedInError();
        const id = uuidv7();
        const h = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
        try {
          await this.attendance.insertBackfill(tx, { id, tenantId, assignmentId: input.assignmentId, workDate: input.workDate, hoursRegular: h(input.hoursRegular), hoursOvertime: h(input.hoursOvertime),
            mediaId: input.mediaId, reason, recordedBy: actor.userId });
        } catch (e) { throw namedLabourRefusal(e); }
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'labour.attendance_backfilled', entityType: 'attendance_record', entityId: id, reason, ip,
          oldValue: null, newValue: { assignmentId: input.assignmentId, bookingId: assignment.bookingId, workDate: input.workDate, hoursRegular: h(input.hoursRegular),
            hoursOvertime: h(input.hoursOvertime), mediaId: input.mediaId, method: 'paper_backfill', reviewStatus: 'needs_review' } });
        return { id, assignmentId: input.assignmentId, workDate: input.workDate, method: 'paper_backfill', reviewStatus: 'needs_review' };
      }, { userId: actor.userId }));
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
