// modules/labour/services/labour-booking.service.ts
// The labour spine: an employer POSTS a booking (with THE DIGNITY FLOOR snapshotted from minimum_wages),
// assigns workers, workers CONSENT, the employer CONFIRMS THE ROSTER (wages escrowed), starts + completes the engagement,
// and WAGES ARE SETTLED from the escrow for the attendance the employer confirmed (Law 2 — through LabourMoneyService).
// Every write: one ACID tx (UoW), state via the machine (Law 5), outbox in-tx (Law 4), idempotent
// mutations (Law 3), quota on create, authz that THROWS (Law 6). Booking concurrency = optimistic version + row lock.
//
// PC-56 TENANT-11b — what changed, finding by finding:
//   F-5   pay = Σ confirmed attendance × rate (+ OT), not one wage unit per worker; a no-show is paid 0 and the row says why;
//         keyed per (assignment, the days it pays) so a later confirm is paid by a later run and a re-run moves nothing.
//   A3    founder decision — `POST /:id/confirm-roster` escrows the wages + the ₹20 fee; start() needs it.
//   F-8   the labour desk (labour.desk) posts / fills / confirms / cancels FOR an employer, each with a recorded consent
//   F-20  (labour_consents); paying a desk-run booking is labour.wages.approve. The employer's own path is unchanged.
//   F-18  women-only is enforced at assign and apply (users.gender; not recorded → refused, said so); the declarations are
//         writable; cancel takes a reason from the lookup and the workers are told it.
//   F-19  reads are owner-checked: a booking's location / escrow / roster are the parties' and the desk's only.
//   F-24  every act is audited with actor, reason, before / after and ip.
//   F-25  µs cursors.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { QUOTA_SERVICE, QuotaService } from '../../../core/quota/quota.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { LabourBooking } from '../domain/labour-booking.entity';
import { BookingAssignment } from '../domain/booking-assignment.entity';
import { DomainEvent, SkillLevel, WageKind } from '../domain/labour.events';
import { BookingStatus, UNREACHABLE_BOOKING_STATUSES, acceptsPayRun } from '../domain/labour-booking.state';
import { Cursor, encodeCursor } from '../domain/cursor';
import { indiaDay, maskPhone, shortName } from '../domain/display';
import { computeWage, escrowEstimate, heldMinor } from '../domain/labour-money';
import { LabourBookingRepository } from '../repositories/labour-booking.repository';
import { BookingAssignmentRepository } from '../repositories/booking-assignment.repository';
import { WorkerProfileRepository } from '../repositories/worker-profile.repository';
import { AttendanceRepository } from '../repositories/attendance.repository';
import { LabourMoneyRepository } from '../repositories/labour-money.repository';
import { MinimumWageService } from './minimum-wage.service';
import { LabourMoneyService } from './labour-money.service';
import { CreateBookingDto } from '../dto/create-labour-booking.dto';
import { EmployerConsentDto } from '../dto/labour-act.dto';
import { LabourActor, canOverseeLabour } from '../policies/labour.policies';
import {
  BookingNotFoundError, AssignmentNotFoundError, WorkerProfileNotFoundError, LabourForbiddenError,
  WageBelowMinimumError, BookingFullError, WorkerAlreadyAssignedError, BookingNotPayableError,
  RosterNotConfirmedError, RosterEmptyError, RosterLockedError, EmployerConsentRequiredError, WomenOnlyBookingError,
  WorkerGenderNotRecordedError, CancelReasonRequiredError, BookingHasUnpaidAttendanceError, BookingNotPayableYetError,
} from '../domain/labour.errors';

export type { LabourActor } from '../policies/labour.policies';
const QUOTA_METRIC = 'labour_bookings';
type ConsentAct = 'post' | 'fill' | 'confirm_roster' | 'cancel';
const ddmmyyyy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

@Injectable()
export class LabourBookingService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(QUOTA_SERVICE) private readonly quota: QuotaService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly money: LabourMoneyService,
    private readonly audit: AuditWriter,
    private readonly bookings: LabourBookingRepository,
    private readonly assignments: BookingAssignmentRepository,
    private readonly workers: WorkerProfileRepository,
    private readonly minWage: MinimumWageService,
    private readonly attendance: AttendanceRepository,
    private readonly moneyRepo: LabourMoneyRepository,
  ) {}

  // ---- employer (or the desk, for an employer, with consent): post a booking (dignity floor enforced) ----
  async create(tenantId: string, actor: LabourActor, idemKey: string, dto: CreateBookingDto, ip: string | null = null) {
    const onBehalf = dto.onBehalf && dto.onBehalf.employerUserId !== actor.userId ? dto.onBehalf : null;
    if (onBehalf ? !actor.canDesk : !(actor.canBook || actor.canDesk)) throw new LabourForbiddenError(onBehalf ? 'posting for an employer requires labour.desk' : 'requires worker.book or labour.desk');
    return this.idem.remember(idemKey, actor.userId, 'labour.booking.create', () =>
      timed(this.metrics, 'labour.booking.create', { tenant: tenantId }, async () => {
        await this.quota.assertWithinLimit(tenantId, QUOTA_METRIC);
        const offered = BigInt(dto.wageOfferedMinor);
        return this.uow.run(tenantId, async (tx) => {
          const employerUserId = onBehalf ? onBehalf.employerUserId : actor.userId;
          if (onBehalf && !(await this.bookings.employerInTenant(tx, tenantId, employerUserId))) throw new LabourForbiddenError('the employer is not a member of this organisation');
          const demandTypeId = await this.bookings.resolveDemandTypeId(tx, dto.demandTypeCode);
          await this.bookings.assertSkillExists(tx, dto.taskSkillId);
          // Snapshot the statutory floor for the region/skill-level on the start date (fail-closed if none).
          const floor = await this.minWage.resolveFloor(tenantId, dto.regionId, dto.skillLevel as SkillLevel, dto.wageKind as WageKind, dto.startDate, tx);
          if (offered < floor) throw new WageBelowMinimumError(offered, floor);
          const id = uuidv7();
          const respondBy = dto.respondByHours ? new Date(Date.now() + dto.respondByHours * 3600_000) : null;
          const booking = LabourBooking.post({
            id, tenantId, bookingNo: '', employerUserId, demandTypeId, taskSkillId: dto.taskSkillId,
            workersNeeded: dto.workersNeeded, startDate: dto.startDate, endDate: dto.endDate, dailyHours: dto.dailyHours,
            wageKind: dto.wageKind as WageKind, wageOfferedMinor: offered, minWageMinor: floor, currencyCode: 'INR',
            overtimeRateMultiplier: 1.5, womenOnly: dto.womenOnly, farmLat: dto.farmLat, farmLng: dto.farmLng, respondBy,
            startTime: dto.startTime ?? null, notes: dto.notes ?? null,
            transportProvided: dto.transportProvided, mealsProvided: dto.mealsProvided, toiletConfirmed: dto.toiletConfirmed,
            drinkingWater: dto.drinkingWater, womanSupervisor: dto.womanSupervisor, transportPickupPoint: dto.transportPickupPoint ?? null,
            transportPickupTime: dto.transportPickupTime ?? null, villageLabel: dto.villageLabel ?? null, onBehalf: !!onBehalf,
          });
          const ins = await this.bookings.insert(tx, booking, actor.userId);
          booking.setBookingNo(ins.bookingNo, ins.createdAt, ins.createdAtRaw);
          let consentId: string | null = null;
          if (onBehalf) consentId = await this.recordConsent(tx, tenantId, id, employerUserId, 'post', onBehalf.consent, actor.userId);
          await this.quota.increment(tx, tenantId, QUOTA_METRIC, 1);
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'labour.booking.created', entityType: 'labour_booking', entityId: id, ip,
            reason: onBehalf ? 'posted by the labour desk for the employer (consent recorded)' : null, oldValue: null,
            newValue: { ...this.auditFacts(booking), onBehalf: !!onBehalf, consentId } });
          await this.flush(tx, tenantId, 'labour_booking', booking.id, booking.pullEvents());
          return this.serializeBooking(booking, { full: true });
        }, { userId: actor.userId });
      }));
  }

  // ---- employer / desk: assign a worker to an open booking ----
  async assign(tenantId: string, actor: LabourActor, bookingId: string, idemKey: string, dto: { workerId: string; wageMinor?: string; consent?: EmployerConsentDto }, ip: string | null = null) {
    if (!(actor.canBook || actor.canDesk)) throw new LabourForbiddenError('requires worker.book or labour.desk');
    return this.idem.remember(idemKey, actor.userId, 'labour.booking.assign', () =>
      this.uow.run(tenantId, async (tx) => {
        const booking = await this.bookings.getForWrite(tx, tenantId, bookingId);
        if (!booking) throw new BookingNotFoundError(bookingId);
        const who = await this.authorizeAct(tx, tenantId, booking, actor, 'fill', dto.consent);
        if (booking.status !== 'open') throw new RosterLockedError(booking.status);
        if (await this.assignments.countActive(tx, tenantId, bookingId) >= booking.workersNeeded) throw new BookingFullError(booking.workersNeeded);
        if (await this.assignments.findByBookingAndWorker(tx, tenantId, bookingId, dto.workerId)) throw new WorkerAlreadyAssignedError();
        const worker = await this.workers.getById(tenantId, dto.workerId, tx);
        if (!worker) throw new WorkerProfileNotFoundError(dto.workerId);
        worker.assertAssignable();                                  // HARD age-18 gate (Law: refuse)
        await this.assertWomenOnly(tx, tenantId, booking, dto.workerId);
        const wage = dto.wageMinor ? BigInt(dto.wageMinor) : booking.wageOfferedMinor;
        if (wage < booking.toProps().minWageMinor) throw new WageBelowMinimumError(wage, booking.toProps().minWageMinor);
        const assignment = BookingAssignment.create({ id: uuidv7(), bookingId, tenantId, workerId: dto.workerId, wageMinor: wage });
        await this.assignments.insert(tx, assignment, actor.userId);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'labour.worker.assigned', entityType: 'labour_booking', entityId: bookingId, ip,
          reason: who.onBehalf ? 'seat filled by the labour desk for the employer (consent recorded)' : null, oldValue: null,
          newValue: { assignmentId: assignment.id, workerId: dto.workerId, wageMinor: wage.toString(), onBehalf: who.onBehalf, consentId: who.consentId } });
        await this.flush(tx, tenantId, 'booking_assignment', assignment.id, assignment.pullEvents());
        return this.serializeAssignment(assignment);
      }, { userId: actor.userId }));
  }

  // ---- worker: SELF-APPLY to an open booking (creates an 'applied' assignment, an interest pool) ----
  async applyAsWorker(tenantId: string, userId: string, bookingId: string, idemKey: string, ip: string | null = null) {
    return this.idem.remember(idemKey, userId, 'labour.booking.apply', () =>
      timed(this.metrics, 'labour.booking.apply', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const booking = await this.bookings.getForWrite(tx, tenantId, bookingId);
          if (!booking) throw new BookingNotFoundError(bookingId);
          if (booking.status !== 'open') throw new BookingNotPayableError(booking.status);    // only open bookings accept applications
          const worker = await this.workers.findByUser(tenantId, userId, tx);                 // the caller's OWN worker profile
          if (!worker) throw new WorkerProfileNotFoundError(userId);
          worker.assertAssignable();                                                          // HARD age-18 gate (Law: refuse)
          await this.assertWomenOnly(tx, tenantId, booking, worker.id);
          if (await this.assignments.findByBookingAndWorker(tx, tenantId, bookingId, worker.id)) throw new WorkerAlreadyAssignedError();
          const assignment = BookingAssignment.apply({ id: uuidv7(), bookingId, tenantId, workerId: worker.id, wageMinor: booking.wageOfferedMinor });
          await this.assignments.insert(tx, assignment, userId);
          await this.audit.write(tx, { tenantId, actorUserId: userId, action: 'labour.worker.applied', entityType: 'labour_booking', entityId: bookingId, ip,
            oldValue: null, newValue: { assignmentId: assignment.id, workerId: worker.id } });
          await this.flush(tx, tenantId, 'booking_assignment', assignment.id, assignment.pullEvents());
          return this.serializeAssignment(assignment);
        }, { userId })));
  }

  // ---- worker: consent (accept) or decline (reject) their own assignment ----
  async respond(tenantId: string, userId: string, assignmentId: string, dto: { decision: 'accept' | 'reject'; voiceConsentMediaId?: string }, ip: string | null = null) {
    return this.uow.run(tenantId, async (tx) => {
      const assignment = await this.assignments.getForUpdate(tx, tenantId, assignmentId);
      if (!assignment) throw new AssignmentNotFoundError(assignmentId);
      const mine = await this.workers.findByUser(tenantId, userId, tx);
      if (!mine || mine.id !== assignment.workerId) throw new LabourForbiddenError('only the assigned worker may respond');
      const booking = await this.bookings.getForWrite(tx, tenantId, assignment.bookingId);
      if (!booking) throw new BookingNotFoundError(assignment.bookingId);
      const before = assignment.status;
      if (dto.decision === 'accept') {
        // The roster is locked once confirmed — the escrow was computed on it (A3).
        if (booking.status !== 'open') throw new RosterLockedError(booking.status);
        if (await this.assignments.countAccepted(tx, tenantId, booking.id) >= booking.workersNeeded) throw new BookingFullError(booking.workersNeeded);
        assignment.accept(new Date(), dto.voiceConsentMediaId ?? null);
      } else assignment.reject();
      await this.assignments.update(tx, assignment);
      await this.audit.write(tx, { tenantId, actorUserId: userId, action: dto.decision === 'accept' ? 'labour.assignment.accepted' : 'labour.assignment.rejected',
        entityType: 'labour_booking', entityId: booking.id, ip, oldValue: { assignmentId, status: before }, newValue: { assignmentId, status: assignment.status } });
      await this.flush(tx, tenantId, 'booking_assignment', assignment.id, assignment.pullEvents());
      return this.serializeAssignment(assignment);
    }, { userId });
  }

  // ---- A3: CONFIRM THE ROSTER — the wages and the fee are set aside in this transaction ----
  async confirmRoster(tenantId: string, actor: LabourActor, bookingId: string, idemKey: string, dto: { reason?: string; consent?: EmployerConsentDto }, ip: string | null = null) {
    if (!(actor.canBook || actor.canDesk)) throw new LabourForbiddenError('requires worker.book or labour.desk');
    return this.idem.remember(idemKey, actor.userId, 'labour.booking.confirm_roster', () =>
      timed(this.metrics, 'labour.booking.confirm_roster', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const booking = await this.bookings.getForWrite(tx, tenantId, bookingId);
          if (!booking) throw new BookingNotFoundError(bookingId);
          const who = await this.authorizeAct(tx, tenantId, booking, actor, 'confirm_roster', dto.consent);
          if (booking.status !== 'open') throw new RosterLockedError(booking.status);
          const accepted = await this.assignments.listAcceptedForUpdate(tx, tenantId, bookingId);
          if (accepted.length === 0) throw new RosterEmptyError();
          const version = booking.version;
          const now = new Date();
          const esc = await this.money.escrowInTx(tx, { tenantId, booking, accepted, actorUserId: actor.userId, onBehalf: who.onBehalf, consentId: who.consentId, today: indiaDay(now) });
          // The seats nobody accepted are closed with the roster: they were not escrowed.
          const lapsed: string[] = [];
          for (const a of await this.assignments.listPendingForUpdate(tx, tenantId, bookingId)) {
            a.expire(); await this.assignments.update(tx, a); lapsed.push(a.id);
            await this.flush(tx, tenantId, 'booking_assignment', a.id, a.pullEvents());
          }
          const b = booking.toProps();
          const recipients = await this.assignments.workerUserIds(tx, tenantId, bookingId, ['accepted']);
          booking.confirmRoster(now, actor.userId, { recipientUserIds: recipients, jobNo: b.bookingNo, startDate: ddmmyyyy(b.startDate), escrowedMinor: esc.wagesMinor.toString() });
          await this.bookings.update(tx, booking, version);
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'labour.roster.confirmed', entityType: 'labour_booking', entityId: bookingId, ip,
            reason: dto.reason ?? (who.onBehalf ? 'roster confirmed by the labour desk with the employer\'s recorded consent' : null),
            oldValue: { status: 'open', escrowedMinor: '0' },
            newValue: { status: 'accepted', workers: accepted.length, days: esc.days, wagesMinor: esc.wagesMinor.toString(), feeMinor: esc.feeMinor.toString(),
              totalMinor: esc.totalMinor.toString(), escrowTxnId: esc.txnId, lapsedAssignments: lapsed, onBehalf: who.onBehalf, consentId: who.consentId } });
          await this.flush(tx, tenantId, 'labour_booking', booking.id, booking.pullEvents());
          return { ...this.serializeBooking(booking, { full: true }), escrowedMinor: esc.wagesMinor.toString(), platformFeeMinor: esc.feeMinor.toString(), employerTotalMinor: esc.totalMinor.toString() };
        }, { userId: actor.userId })));
  }

  // ---- employer / desk: start the engagement (the roster must be confirmed — the money is held) ----
  async start(tenantId: string, actor: LabourActor, bookingId: string, ip: string | null = null, reason: string | null = null) {
    return this.transitionBooking(tenantId, actor, bookingId, 'labour.booking.started', ip, reason, async (booking) => {
      if (booking.status === 'open') throw new RosterNotConfirmedError(booking.status);
      booking.start();
    });
  }

  // ---- employer / desk: confirm work done ----
  async complete(tenantId: string, actor: LabourActor, bookingId: string, ip: string | null = null, reason: string | null = null) {
    return this.transitionBooking(tenantId, actor, bookingId, 'labour.booking.completed', ip, reason, async (booking) => { booking.complete(); });
  }

  // ---- employer / desk (consent): cancel with a reason from the lookup; escrow back, fee kept ----
  async cancel(tenantId: string, actor: LabourActor, bookingId: string, dto: { reasonCode: string; reasonText?: string; consent?: EmployerConsentDto }, ip: string | null = null) {
    if (!(actor.canBook || actor.canDesk)) throw new LabourForbiddenError('requires worker.book or labour.desk');
    return this.uow.run(tenantId, async (tx) => {
      const booking = await this.bookings.getForWrite(tx, tenantId, bookingId);
      if (!booking) throw new BookingNotFoundError(bookingId);
      const who = await this.authorizeAct(tx, tenantId, booking, actor, 'cancel', dto.consent);
      const reason = await this.bookings.resolveCancelReason(tx, dto.reasonCode);
      if (!reason) throw new CancelReasonRequiredError('CANCEL_REASON_UNKNOWN');
      const text = dto.reasonText?.trim() || null;
      if (reason.textRequired && !text) throw new CancelReasonRequiredError('CANCEL_REASON_TEXT_REQUIRED');
      if (booking.status === 'in_progress') {
        const unpaid = await this.attendance.countConfirmedUnpaidForBooking(tx, tenantId, bookingId);
        if (unpaid > 0) throw new BookingHasUnpaidAttendanceError(unpaid);
      }
      const version = booking.version;
      const from = booking.status;
      const b = booking.toProps();
      const recipients = await this.assignments.workerUserIds(tx, tenantId, bookingId, ['accepted', 'pending_worker', 'applied']);
      const words = text ? (reason.textRequired ? text : `${reason.name} — ${text}`) : reason.name;
      const rel = await this.money.releaseInTx(tx, { tenantId, booking, actorUserId: actor.userId, reason: 'cancelled' });
      booking.cancel({ reasonId: reason.id, reasonCode: reason.code, reasonText: text, reasonWords: words, by: actor.userId, now: new Date(),
        extra: { recipientUserIds: recipients, jobNo: b.bookingNo, startDate: ddmmyyyy(b.startDate), releasedMinor: rel.releasedMinor.toString(), feeKeptMinor: rel.feeKeptMinor.toString() } });
      await this.bookings.update(tx, booking, version);
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'labour.booking.cancelled', entityType: 'labour_booking', entityId: bookingId, ip, reason: words,
        oldValue: { status: from }, newValue: { status: 'cancelled', reasonCode: reason.code, reasonText: text, releasedMinor: rel.releasedMinor.toString(), feeKeptMinor: rel.feeKeptMinor.toString(),
          releaseTxnId: rel.txnId, workersNotified: recipients.length, onBehalf: who.onBehalf, consentId: who.consentId } });
      await this.flush(tx, tenantId, 'labour_booking', booking.id, booking.pullEvents());
      return { ...this.serializeBooking(booking, { full: true }), releasedMinor: rel.releasedMinor.toString(), feeKeptMinor: rel.feeKeptMinor.toString(), workersNotified: recipients.length };
    }, { userId: actor.userId });
  }

  // ---- A2 + A4: THE PAY RUN — confirmed attendance × rate, from the escrow ----
  async payWages(tenantId: string, actor: LabourActor, bookingId: string, idemKey: string, ip: string | null = null, reason: string | null = null) {
    return this.idem.remember(idemKey, actor.userId, 'labour.booking.pay', () =>
      timed(this.metrics, 'labour.booking.pay', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const booking = await this.bookings.getForWrite(tx, tenantId, bookingId);
          if (!booking) throw new BookingNotFoundError(bookingId);
          const isEmployer = booking.employerUserId === actor.userId && (actor.canBook || actor.canDesk);
          // A6: the employer pays their own booking; labour.wages.approve pays a DESK-RUN booking. Nobody else.
          if (!isEmployer && !(actor.canApproveWages && booking.toProps().onBehalf)) {
            throw new LabourForbiddenError(booking.toProps().onBehalf ? 'paying a desk-run booking requires labour.wages.approve' : 'only the employer may pay this booking');
          }
          if (!acceptsPayRun(booking.status)) throw new BookingNotPayableYetError(booking.status);
          const before = booking.status;
          if (booking.status === 'paid') {
            return { ...this.serializeBooking(booking, { full: true }), movedMinor: '0', totalPaidMinor: '0', workersPaid: 0, lines: [], outstanding: 0, releasedMinor: '0', toppedUpMinor: '0', source: 'escrow' };
          }
          const version = booking.version;
          const accepted = await this.assignments.listAcceptedForUpdate(tx, tenantId, bookingId);
          if (accepted.length === 0) throw new BookingNotPayableError('no accepted workers to pay');
          // A completed booking is settled only when no clocked-out day still waits for the employer's confirm.
          const waiting = booking.status === 'completed' ? await this.attendance.countAwaitingConfirmForBooking(tx, tenantId, bookingId) : 0;
          const run = await this.money.payRunInTx(tx, { tenantId, booking, accepted, actorUserId: actor.userId, ip, reason, mayRelease: waiting === 0 });
          // Completed + nothing outstanding + no day still waiting for the employer → the booking is paid and the escrow is home.
          let markedPaid = false;
          if (booking.status === 'completed' && run.outstanding === 0 && waiting === 0 && run.released) {
            for (const a of accepted) { if (a.status === 'accepted') { a.markPaid(); await this.assignments.update(tx, a); await this.flush(tx, tenantId, 'booking_assignment', a.id, a.pullEvents()); } }
            booking.markPaid(run.movedMinor, accepted.length);
            await this.bookings.update(tx, booking, version);
            markedPaid = true;
          }
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'labour.pay_run', entityType: 'labour_booking', entityId: bookingId, ip, reason,
            oldValue: { status: before }, newValue: { status: booking.status, movedMinor: run.movedMinor.toString(), toppedUpMinor: run.toppedUpMinor.toString(), releasedMinor: run.releasedMinor.toString(),
              outstanding: run.outstanding, daysAwaitingConfirm: waiting, source: run.source, lines: run.lines.map((l) => ({ assignmentId: l.assignmentId, paidMinor: l.paidThisRunMinor, status: l.status })) } });
          await this.flush(tx, tenantId, 'labour_booking', booking.id, booking.pullEvents());
          return { ...this.serializeBooking(booking, { full: true }), movedMinor: run.movedMinor.toString(), totalPaidMinor: run.movedMinor.toString(),
            workersPaid: run.lines.filter((l) => BigInt(l.paidThisRunMinor) > 0n).length, lines: run.lines, outstanding: run.outstanding,
            daysAwaitingConfirm: waiting, releasedMinor: run.releasedMinor.toString(), toppedUpMinor: run.toppedUpMinor.toString(), source: run.source, markedPaid };
        }, { userId: actor.userId })));
  }

  /** The respond-timeout job: expire an OPEN booking past respond_by + lapse its pending assignments. Idempotent. */
  async expireBooking(tenantId: string, bookingId: string, now: Date = new Date()): Promise<boolean> {
    return this.uow.run(tenantId, async (tx) => {
      const booking = await this.bookings.getForWrite(tx, tenantId, bookingId);
      const respondBy = booking?.toProps().respondBy;
      if (!booking || booking.status !== 'open' || !respondBy || new Date(respondBy).getTime() >= now.getTime()) return false;   // moved on — no-op
      const version = booking.version;
      for (const a of await this.assignments.listPendingForUpdate(tx, tenantId, bookingId)) {
        a.expire();
        await this.assignments.update(tx, a);
        await this.flush(tx, tenantId, 'booking_assignment', a.id, a.pullEvents());
      }
      booking.expire();
      await this.bookings.update(tx, booking, version);
      await this.audit.write(tx, { tenantId, actorUserId: null, action: 'labour.booking.expired', entityType: 'labour_booking', entityId: bookingId,
        reason: 'no roster confirmed by respond-by', oldValue: { status: 'open' }, newValue: { status: 'expired', respondBy } });
      await this.flush(tx, tenantId, 'labour_booking', booking.id, booking.pullEvents());
      return true;
    }, { userId: 'system' });
  }

  // ---- reads (A8 owner checks) ----
  async getBooking(tenantId: string, actor: LabourActor, id: string) {
    const b = await this.bookings.getById(tenantId, id);
    if (!b) throw new BookingNotFoundError(id);
    const view = await this.viewOf(tenantId, actor, b);
    if (view === 'none') throw new BookingNotFoundError(id);
    if (view === 'market') return this.serializeBooking(b, { full: false });
    const p = b.toProps();
    const [{ escrow, payouts }, rule, names, consents] = await Promise.all([
      this.money.moneyFacts(tenantId, id), this.money.feeRule(null, tenantId, indiaDay(new Date())), this.bookings.skillNames(tenantId, [p.taskSkillId]),
      view === 'worker' ? Promise.resolve([]) : this.moneyRepo.consentsFor(tenantId, id),
    ]);
    const filledCount = await this.assignments.countFilled(tenantId, id);
    const preview = escrowEstimate({ kind: p.wageKind, startDate: p.startDate, endDate: p.endDate, dailyHours: p.dailyHours, rates: Array.from({ length: p.workersNeeded }, () => p.wageOfferedMinor), fee: rule });
    const paidMinor = payouts.reduce((s, r) => s + (r.baseTxnId ? r.baseMinor : 0n) + (r.otTxnId ? r.otMinor : 0n), 0n);
    const isEmployer = p.employerUserId === actor.userId;
    return {
      ...this.serializeBooking(b, { full: true }, { escrow, filledCount, taskName: names.get(p.taskSkillId) ?? null }),
      costPreview: { workers: p.workersNeeded, days: preview.days, units: preview.units, rateMinor: p.wageOfferedMinor.toString(), wagesMinor: preview.wagesMinor.toString(),
        platformFeeMinor: preview.feeMinor.toString(), employerTotalMinor: preview.totalMinor.toString(), feeRule: rule ? { kind: rule.kind, amountMinor: rule.amountMinor.toString(), capMinor: rule.capMinor?.toString() ?? null, capRuleNote: rule.capRuleNote } : null },
      payoutsSummary: view === 'worker' ? null : { rows: payouts.length, paidMinor: paidMinor.toString(), awaitingTopup: payouts.filter((r) => r.status === 'awaiting_topup' || r.status === 'partial').length },
      consents: consents.map((c) => ({ act: c.act, channel: c.channel, mediaId: c.mediaId, recordedAt: c.recordedAt })),
      viewerCan: view === 'worker' ? null : this.viewerCan(b, actor, isEmployer),
      fairnessFee: { built: false },
    };
  }
  async listBookings(tenantId: string, actor: LabourActor, q: { box: 'mine' | 'open' | 'all'; status?: string; taskSkillId?: string; sort?: 'recent' | 'starts'; counts?: boolean; cursor?: Cursor; limit: number }) {
    if (q.box === 'all' && !canOverseeLabour(actor)) throw new LabourForbiddenError('requires labour.desk or booking.manage');
    const employerUserId = q.box === 'mine' ? actor.userId : undefined;
    const rows = await this.bookings.listFor(tenantId, { employerUserId, openOnly: q.box === 'open', status: q.status, taskSkillId: q.taskSkillId, sort: q.sort, cursor: q.cursor, limit: q.limit });
    const full = q.box !== 'open';
    const ids = rows.map((r) => r.booking.id);
    const [escrows, names] = await Promise.all([full ? this.money.escrowsFor(tenantId, ids) : Promise.resolve(new Map()), this.bookings.skillNames(tenantId, [...new Set(rows.map((r) => r.booking.toProps().taskSkillId))])]);
    const items = rows.map((r) => this.serializeBooking(r.booking, { full }, { escrow: escrows.get(r.booking.id) ?? null, filledCount: r.filledCount, taskName: names.get(r.booking.toProps().taskSkillId) ?? null }));
    const last = rows[rows.length - 1]?.booking.toProps();
    const nextCursor = rows.length === q.limit && last
      ? (q.sort === 'starts' ? encodeCursor(`${last.startDate} 00:00:00`, last.id) : encodeCursor(last.createdAtRaw ?? null, last.id)) : null;
    const counts = q.counts && q.box !== 'open' ? await this.bookings.countByStatus(tenantId, employerUserId) : null;
    return { items, nextCursor, counts, unreachableStatuses: [...UNREACHABLE_BOOKING_STATUSES] };
  }
  async getAssignment(tenantId: string, actor: LabourActor, id: string) {
    const a = await this.assignments.getById(tenantId, id);
    if (!a) throw new AssignmentNotFoundError(id);
    const mine = await this.workers.findByUser(tenantId, actor.userId);
    if (mine && mine.id === a.workerId) return this.serializeAssignment(a);
    const b = await this.bookings.getById(tenantId, a.bookingId);
    if (b && (b.employerUserId === actor.userId || canOverseeLabour(actor))) return this.serializeAssignment(a);
    throw new AssignmentNotFoundError(id);
  }
  async listAssignments(tenantId: string, actor: LabourActor, q: { box: 'mine' | 'booking'; bookingId?: string; status?: string; cursor?: Cursor; limit: number }) {
    if (q.box === 'mine') {
      const mine = await this.workers.findByUser(tenantId, actor.userId);
      if (!mine) return { items: [], nextCursor: null };
      const rows = await this.assignments.listFor(tenantId, { workerId: mine.id, status: q.status, cursor: q.cursor, limit: q.limit });
      const bookingIds = [...new Set(rows.map((r) => r.assignment.bookingId))];
      const escrows = await this.money.escrowsFor(tenantId, bookingIds);
      const items = rows.map((r) => ({ ...this.serializeAssignment(r.assignment), escrowedMinor: (() => { const e = escrows.get(r.assignment.bookingId); return e && e.status === 'held' ? heldMinor(e).toString() : '0'; })() }));
      const last = rows[rows.length - 1];
      return { items, nextCursor: rows.length === q.limit && last ? encodeCursor(last.createdAtRaw, last.assignment.id) : null };
    }
    if (!q.bookingId) throw new BookingNotFoundError('');
    const b = await this.bookings.getById(tenantId, q.bookingId);
    if (!b) throw new BookingNotFoundError(q.bookingId);
    const oversee = b.employerUserId === actor.userId || canOverseeLabour(actor);
    if (!oversee) {
      // An assigned worker sees their OWN row only; anyone else sees nothing (404 — no enumeration).
      const mine = await this.workers.findByUser(tenantId, actor.userId);
      if (!mine) throw new BookingNotFoundError(q.bookingId);
      const own = (await this.assignments.listFor(tenantId, { bookingId: q.bookingId, workerId: mine.id, limit: 1 }));
      if (own.length === 0) throw new BookingNotFoundError(q.bookingId);
      return { items: own.map((r) => this.serializeAssignment(r.assignment)), nextCursor: null };
    }
    const rows = await this.assignments.rosterFor(tenantId, q.bookingId, { status: q.status, cursor: q.cursor, limit: q.limit });
    const p = b.toProps();
    const [facts, payouts] = await Promise.all([this.attendance.rosterFacts(tenantId, rows.map((r) => r.assignment.id)), this.moneyRepo.payoutsForBooking(tenantId, q.bookingId)]);
    const items = rows.map((r) => {
      const f = facts.get(r.assignment.id) ?? { confirmed: 0, awaitingConfirm: 0, clockedIn: 0, paidDays: 0 };
      const mineRows = payouts.filter((x) => x.assignmentId === r.assignment.id);
      const paid = mineRows.reduce((s, x) => s + (x.baseTxnId ? x.baseMinor : 0n) + (x.otTxnId ? x.otMinor : 0n), 0n);
      const owedOutstanding = mineRows.reduce((s, x) => s + (x.status === 'awaiting_topup' ? x.baseMinor + x.otMinor : x.status === 'partial' ? x.otMinor : 0n), 0n);
      const zero = mineRows.find((x) => x.status === 'zero')?.zeroReason ?? null;
      return {
        ...this.serializeAssignment(r.assignment),
        workerShortName: shortName(r.workerFullName), workerPhoneMasked: r.workerPhone ? maskPhone(r.workerPhone) : null,
        confirmedDays: f.confirmed, awaitingConfirmDays: f.awaitingConfirm, clockedInNow: f.clockedIn, paidDays: f.paidDays,
        paidMinor: paid.toString(), awaitingTopupMinor: owedOutstanding.toString(), zeroReason: zero,
        plannedMinor: escrowEstimate({ kind: p.wageKind, startDate: p.startDate, endDate: p.endDate, dailyHours: p.dailyHours, rates: [r.assignment.wageMinor], fee: null }).wagesMinor.toString(),
      };
    });
    const last = rows[rows.length - 1];
    return { items, nextCursor: rows.length === q.limit && last ? encodeCursor(last.createdAtRaw, last.assignment.id) : null };
  }
  /** One assignment's attendance days (employer / desk) — the per-day confirm list on the job detail. */
  async assignmentDays(tenantId: string, actor: LabourActor, assignmentId: string) {
    const a = await this.assignments.getById(tenantId, assignmentId);
    if (!a) throw new AssignmentNotFoundError(assignmentId);
    const b = await this.bookings.getById(tenantId, a.bookingId);
    if (!b || !(b.employerUserId === actor.userId || canOverseeLabour(actor))) throw new AssignmentNotFoundError(assignmentId);
    const days = await this.attendance.daysForAssignment(tenantId, assignmentId);
    return days.map((d) => ({ id: d.id, workDate: d.workDate, clockInAt: d.clockInAt, clockOutAt: d.clockOutAt, hoursRegular: d.hoursRegular, hoursOvertime: d.hoursOvertime,
      status: d.confirmedByEmployer ? 'confirmed' : d.clockOutAt ? 'clocked_out' : 'clocked_in', paid: d.wagePayoutId !== null }));
  }

  /** A11 — the tenant-wide labour summary (desk / manage). Every figure is counted from rows; nothing is estimated. */
  async summary(tenantId: string, actor: LabourActor, now: Date = new Date()) {
    if (!canOverseeLabour(actor)) throw new LabourForbiddenError('requires labour.desk or booking.manage');
    const today = indiaDay(now);
    const since = new Date(now.getTime() - 30 * 86_400_000);
    const [open, att, awaiting, fill] = await Promise.all([
      this.moneyRepo.openFacts(tenantId), this.attendance.summaryFacts(tenantId, today), this.attendance.awaitingConfirm(tenantId), this.moneyRepo.fillFacts(tenantId, since),
    ]);
    let unlocks = 0n; let taskDays = 0;
    for (const d of awaiting) {
      if (d.wageKind === 'per_task') { taskDays++; continue; }
      const w = computeWage({ kind: d.wageKind as WageKind, rateMinor: BigInt(d.rateMinor), dailyHours: d.dailyHours, overtimeMultiplier: d.multiplier,
        days: [{ id: 'x', hoursRegular: d.hoursRegular, hoursOvertime: d.hoursOvertime }], bookingCompleted: false, taskPaidBefore: false });
      unlocks += w.baseMinor + (w.otStatus === 'due' ? w.otMinor : 0n);
    }
    const sorted = [...fill.fillHours].sort((x, y) => x - y);
    const median = sorted.length === 0 ? null : sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    return {
      asOfDay: today,
      openJobs: open.openJobs, workersNeeded: open.workersNeeded,
      inProgressToday: att.inProgressToday, clockedInNow: att.clockedInNow,
      awaitingConfirm: { bookings: new Set(awaiting.map((x) => x.bookingId)).size, days: awaiting.length, wagesUnlockedMinor: unlocks.toString(), perTaskDays: taskDays },
      fill30d: fill.seatsNeeded === 0
        ? { rateBps: null, reason: 'no_jobs_in_30d', posted: fill.posted, seatsNeeded: 0, seatsFilled: 0, medianHoursToFill: null, medianReason: 'no_jobs_in_30d' }
        : { rateBps: Math.round((fill.seatsFilled * 10_000) / fill.seatsNeeded), reason: null, posted: fill.posted, seatsNeeded: fill.seatsNeeded, seatsFilled: fill.seatsFilled,
            medianHoursToFill: median === null ? null : Math.round(median * 10) / 10, medianReason: median === null ? 'no_job_fully_filled_in_30d' : null },
    };
  }

  // ---- helpers ----
  /** A6 — may this actor perform `act` on this booking, and on whose behalf? The employer acts for themself (worker.book or
   *  the desk acting as its own employer); the desk acts FOR another employer only with that employer's recorded consent for
   *  THIS act (an earlier one for the same act on the booking counts — e.g. the second seat filled after the first). */
  private async authorizeAct(tx: TxContext, tenantId: string, booking: LabourBooking, actor: LabourActor, act: ConsentAct | 'start' | 'complete', consent?: EmployerConsentDto): Promise<{ onBehalf: boolean; consentId: string | null }> {
    if (booking.employerUserId === actor.userId && (actor.canBook || actor.canDesk)) return { onBehalf: false, consentId: null };
    if (!actor.canDesk) throw new LabourForbiddenError('only the employer or the labour desk may act on this booking');
    if (act === 'start' || act === 'complete') return { onBehalf: true, consentId: null };
    if (consent) return { onBehalf: true, consentId: await this.recordConsent(tx, tenantId, booking.id, booking.employerUserId, act, consent, actor.userId) };
    const existing = act === 'fill' ? await this.moneyRepo.latestConsent(tx, tenantId, booking.id, 'fill') : null;
    if (existing) return { onBehalf: true, consentId: existing.id };
    throw new EmployerConsentRequiredError(act.replace('_', ' '));
  }
  private async recordConsent(tx: TxContext, tenantId: string, bookingId: string, employerUserId: string, act: ConsentAct, c: EmployerConsentDto, recordedBy: string): Promise<string> {
    if (c.channel !== 'otp' && !c.mediaId) throw new EmployerConsentRequiredError(act, 'EMPLOYER_CONSENT_EVIDENCE_REQUIRED');
    const id = uuidv7();
    await this.moneyRepo.insertConsent(tx, { id, tenantId, bookingId, employerUserId, act, channel: c.channel, mediaId: c.mediaId ?? null, note: c.note?.trim() || null, recordedBy });
    return id;
  }
  /** A7 — women-only is a first-class field: a worker not recorded as a woman is refused, and one with no gender recorded is
   *  refused by name (the profile carries no declaration to rely on). */
  private async assertWomenOnly(tx: TxContext, tenantId: string, booking: LabourBooking, workerId: string): Promise<void> {
    if (!booking.toProps().womenOnly) return;
    const g = await this.assignments.workerGender(tx, tenantId, workerId);
    if (g === null) throw new WorkerGenderNotRecordedError();
    if (g !== 'female') throw new WomenOnlyBookingError();
  }
  private async viewOf(tenantId: string, actor: LabourActor, b: LabourBooking): Promise<'full' | 'worker' | 'market' | 'none'> {
    if (b.employerUserId === actor.userId || canOverseeLabour(actor)) return 'full';
    if (await this.assignments.userIsOnBooking(tenantId, b.id, actor.userId)) return 'worker';
    return b.status === 'open' ? 'market' : 'none';
  }
  private viewerCan(b: LabourBooking, actor: LabourActor, isEmployer: boolean) {
    const s = b.status as BookingStatus;
    const self = isEmployer && (actor.canBook || actor.canDesk);
    const desk = !isEmployer && actor.canDesk;
    const act = self || desk;
    return {
      assign: act && s === 'open', confirmRoster: act && s === 'open', start: act && s === 'accepted', complete: act && s === 'in_progress',
      cancel: act && (s === 'open' || s === 'accepted' || s === 'in_progress'),
      pay: (self || (actor.canApproveWages && b.toProps().onBehalf)) && (s === 'in_progress' || s === 'completed'),
      confirmAttendance: (isEmployer || canOverseeLabour(actor)) && (s === 'in_progress' || s === 'completed'),
      needsConsent: desk, payNeedsApprove: !self && b.toProps().onBehalf,
    };
  }
  private async transitionBooking(tenantId: string, actor: LabourActor, bookingId: string, action: string, ip: string | null, reason: string | null, mutate: (b: LabourBooking, tx: TxContext) => Promise<void>) {
    if (!(actor.canBook || actor.canDesk)) throw new LabourForbiddenError('requires worker.book or labour.desk');
    return this.uow.run(tenantId, async (tx) => {
      const booking = await this.bookings.getForWrite(tx, tenantId, bookingId);
      if (!booking) throw new BookingNotFoundError(bookingId);
      const who = await this.authorizeAct(tx, tenantId, booking, actor, action === 'labour.booking.started' ? 'start' : 'complete');
      const version = booking.version;
      const from = booking.status;
      await mutate(booking, tx);
      await this.bookings.update(tx, booking, version);
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action, entityType: 'labour_booking', entityId: bookingId, ip,
        reason: reason ?? (who.onBehalf ? 'by the labour desk for the employer' : null), oldValue: { status: from }, newValue: { status: booking.status, onBehalf: who.onBehalf } });
      await this.flush(tx, tenantId, 'labour_booking', booking.id, booking.pullEvents());
      return this.serializeBooking(booking, { full: true });
    }, { userId: actor.userId });
  }
  private auditFacts(b: LabourBooking) {
    const p = b.toProps();
    return { bookingNo: p.bookingNo, employerUserId: p.employerUserId, workersNeeded: p.workersNeeded, startDate: p.startDate, endDate: p.endDate, dailyHours: p.dailyHours,
      wageKind: p.wageKind, wageOfferedMinor: p.wageOfferedMinor.toString(), minWageMinor: p.minWageMinor.toString(), womenOnly: p.womenOnly,
      declarations: { transport: !!p.transportProvided, meals: !!p.mealsProvided, toilet: !!p.toiletConfirmed, drinkingWater: !!p.drinkingWater, womanSupervisor: !!p.womanSupervisor,
        pickupPoint: p.transportPickupPoint ?? null, pickupTime: p.transportPickupTime ?? null } };
  }
  serializeBooking(b: LabourBooking, opt: { full: boolean }, extra: { escrow?: import('../repositories/labour-money.repository').EscrowRow | null; filledCount?: number; taskName?: string | null } = {}) {
    const v = b.toProps();
    const e = extra.escrow ?? null;
    const base = {
      id: v.id, bookingNo: v.bookingNo, employerUserId: v.employerUserId, demandTypeId: v.demandTypeId, taskSkillId: v.taskSkillId, taskName: extra.taskName ?? null,
      workersNeeded: v.workersNeeded, neededCount: v.workersNeeded, filledCount: extra.filledCount ?? null, startDate: v.startDate, endDate: v.endDate,
      dailyHours: v.dailyHours, overtimeRateMultiplier: v.overtimeRateMultiplier, wageKind: v.wageKind, wageOfferedMinor: v.wageOfferedMinor.toString(),
      minWageMinor: v.minWageMinor.toString(), currencyCode: v.currencyCode, womenOnly: v.womenOnly, status: v.status, respondBy: v.respondBy, version: v.version,
      createdAt: v.createdAt, startTime: v.startTime ?? null, notes: v.notes ?? null, employerName: v.employerName ?? null, villageLabel: v.villageLabel ?? null,
      declarations: { transport: !!v.transportProvided, meals: !!v.mealsProvided, toilet: !!v.toiletConfirmed, drinkingWater: !!v.drinkingWater, womanSupervisor: !!v.womanSupervisor,
        pickupPoint: v.transportPickupPoint ?? null, pickupTime: v.transportPickupTime ?? null },
    };
    if (!opt.full) return { ...base, escrowedMinor: null, platformFeeMinor: null };
    return {
      ...base, farmLat: v.farmLat, farmLng: v.farmLng, onBehalf: !!v.onBehalf,
      escrowedMinor: e ? (e.status === 'held' ? heldMinor(e).toString() : '0') : null,
      escrow: e ? { status: e.status, expectedMinor: e.expectedMinor.toString(), feeMinor: e.feeMinor.toString(), toppedUpMinor: e.toppedUpMinor.toString(), paidMinor: e.paidMinor.toString(),
        releasedMinor: e.releasedMinor.toString(), heldMinor: heldMinor(e).toString(), releaseReason: e.releaseReason, releasedAt: e.releasedAt, confirmedAt: e.createdAt } : null,
      platformFeeMinor: e ? e.feeMinor.toString() : null,
      rosterConfirmedAt: v.rosterConfirmedAt ?? null, startedAt: v.startedAt ?? null, completedAt: v.completedAt ?? null,
      cancel: v.cancelledAt ? { reasonCode: v.cancelReasonCode ?? null, reasonText: v.cancelReasonText ?? null, at: v.cancelledAt } : null,
    };
  }
  private serializeAssignment(a: BookingAssignment) {
    const v = a.toProps();
    return { id: v.id, bookingId: v.bookingId, workerId: v.workerId, status: v.status, wageMinor: v.wageMinor.toString(), acceptedAt: v.acceptedAt, createdAt: v.createdAt };
  }
  private async flush(tx: TxContext, tenantId: string, aggregateType: string, aggregateId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType, aggregateId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
