// modules/labour/services/worker-advance.service.ts · PC-56 TENANT-SW-b · C2 — WORKER WAGE ADVANCES (founder decision 2026-10-03: "advances
// recovered ≤ 25 %"). `worker_advances` existed since 0008 with no reader and no writer (SWEEP F-11); this is its only writer.
//
//   request   the worker (their own assignment), the employer, or the labour desk asks for an advance against ONE assignment, with a reason.
//             The DATABASE caps all advances on the assignment at 50 % of its expected wage (days × rate — computed in SQL from the booking,
//             never taken from the caller) — trg_wa_moves `[ADVANCE_OVER_CAP]`.
//   approve   the booking's employer, or a holder of advance.approve (the labour desk — with the employer's RECORDED consent, act `advance`).
//             The DATABASE refuses the requester and the worker (`[ADVANCE_APPROVER_IS_REQUESTER]`, `[ADVANCE_APPROVER_IS_WORKER]`). In the
//             same transaction the advance is DISBURSED from the booking escrow: wage-advance:<id>, employer Hold −A → worker Main +A
//             (labour_escrows.advanced_minor grows); an escrow that cannot cover it refuses by name (ADVANCE_ESCROW_SHORT) and nothing moves.
//   reject    the same people, with a reason.
// Recovery is the pay run's (labour-money.service payRunInTx): min(outstanding, 25 % of each payout's gross). Write-off is REFUSED BY NAME.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { LabourActor, canOverseeLabour } from '../policies/labour.policies';
import { cleanReason, maskPhone, shortName } from '../domain/display';
import { advanceCap, expectedForAssignment, plannedDays } from '../domain/labour-money';
import { encodeCursor, Cursor } from '../domain/cursor';
import {
  AdvanceNotAllowedError, AdvanceNotFoundError, AssignmentNotFoundError, BookingNotFoundError, EmployerConsentRequiredError, LabourForbiddenError,
  namedLabourRefusal,
} from '../domain/labour.errors';
import { EmployerConsentDto } from '../dto/labour-act.dto';
import { BookingAssignmentRepository } from '../repositories/booking-assignment.repository';
import { LabourBookingRepository } from '../repositories/labour-booking.repository';
import { LabourMoneyRepository, AdvanceRow } from '../repositories/labour-money.repository';
import { WorkerProfileRepository } from '../repositories/worker-profile.repository';
import { LabourMoneyService } from './labour-money.service';

@Injectable()
export class WorkerAdvanceService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly audit: AuditWriter,
    private readonly assignments: BookingAssignmentRepository,
    private readonly bookings: LabourBookingRepository,
    private readonly workers: WorkerProfileRepository,
    private readonly moneyRepo: LabourMoneyRepository,
    private readonly money: LabourMoneyService,
  ) {}

  async request(tenantId: string, actor: LabourActor, input: { assignmentId: string; amountMinor: string; reason: string }, idemKey: string, ip: string | null) {
    const reason = cleanReason(input.reason);
    if (!reason) throw new AdvanceNotAllowedError('an advance request carries a reason (3–300 characters)');
    if (!/^\d{1,15}$/.test(input.amountMinor) || BigInt(input.amountMinor) <= 0n) throw new AdvanceNotAllowedError('an advance is a positive amount in minor units');
    const amount = BigInt(input.amountMinor);
    return this.idem.remember(idemKey, actor.userId, 'labour.advance.request', () =>
      this.uow.run(tenantId, async (tx) => {
        const a = await this.assignments.getForUpdate(tx, tenantId, input.assignmentId);
        if (!a) throw new AssignmentNotFoundError(input.assignmentId);
        const booking = await this.bookings.getById(tenantId, a.bookingId, tx);
        if (!booking) throw new BookingNotFoundError(a.bookingId);
        const worker = await this.workers.getById(tenantId, a.workerId, tx);
        if (!worker) throw new AssignmentNotFoundError(input.assignmentId);
        const isWorker = worker.userId === actor.userId;
        const isEmployer = booking.employerUserId === actor.userId && (actor.canBook || actor.canDesk);
        if (!isWorker && !isEmployer && !actor.canDesk) throw new AssignmentNotFoundError(input.assignmentId);
        if (a.status !== 'accepted') throw new AdvanceNotAllowedError('an advance is against an accepted place on a confirmed roster');
        if (booking.status !== 'accepted' && booking.status !== 'in_progress') throw new AdvanceNotAllowedError(`the job is ${booking.status}: an advance is drawn on a confirmed, unfinished job`);
        const id = uuidv7();
        try {
          await this.moneyRepo.insertAdvance(tx, { id, tenantId, assignmentId: a.id, bookingId: booking.id, workerId: a.workerId, workerUserId: worker.userId,
            employerUserId: booking.employerUserId, amountMinor: amount, requestedBy: actor.userId, reason });
        } catch (e) { throw namedLabourRefusal(e); }
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'labour.advance.requested', entityType: 'worker_advance', entityId: id, reason, ip,
          oldValue: null, newValue: { assignmentId: a.id, bookingId: booking.id, amountMinor: amount.toString(), requestedBy: isWorker ? 'worker' : isEmployer ? 'employer' : 'desk' } });
        return { id, status: 'requested', amountMinor: amount.toString(), assignmentId: a.id, bookingId: booking.id };
      }, { userId: actor.userId }));
  }

  async approve(tenantId: string, actor: LabourActor, advanceId: string, input: { reason: string; consent?: EmployerConsentDto }, idemKey: string, ip: string | null) {
    const reason = cleanReason(input.reason);
    if (!reason) throw new AdvanceNotAllowedError('an approval carries a reason (3–300 characters)');
    return this.idem.remember(idemKey, actor.userId, 'labour.advance.approve', () =>
      this.uow.run(tenantId, async (tx) => {
        const adv = await this.moneyRepo.advanceForUpdate(tx, tenantId, advanceId);
        if (!adv || !adv.bookingId) throw new AdvanceNotFoundError(advanceId);
        const booking = await this.bookings.getForWrite(tx, tenantId, adv.bookingId);
        if (!booking) throw new BookingNotFoundError(adv.bookingId);
        const isEmployer = booking.employerUserId === actor.userId && (actor.canBook || actor.canDesk);
        if (!isEmployer && !actor.canApproveAdvance) throw new LabourForbiddenError('approving an advance needs the employer or advance.approve');
        if (adv.status !== 'requested') throw new AdvanceNotAllowedError(`this advance is already ${adv.status}`);
        let consentId: string | null = null;
        if (!isEmployer) {
          // the labour desk spends the EMPLOYER's escrow — only with the employer's recorded consent for this act
          if (!input.consent) throw new EmployerConsentRequiredError('approve an advance');
          if (input.consent.channel !== 'otp' && !input.consent.mediaId) throw new EmployerConsentRequiredError('approve an advance', 'EMPLOYER_CONSENT_EVIDENCE_REQUIRED');
          consentId = uuidv7();
          await this.moneyRepo.insertConsent(tx, { id: consentId, tenantId, bookingId: booking.id, employerUserId: booking.employerUserId, act: 'advance', channel: input.consent.channel,
            mediaId: input.consent.mediaId ?? null, note: input.consent.note?.trim() || null, recordedBy: actor.userId });
        }
        try {
          const { txnId } = await this.money.disburseAdvanceInTx(tx, { tenantId, booking, advanceId, workerUserId: adv.workerUserId as string, amountMinor: adv.amountMinor, actorUserId: actor.userId });
          await this.moneyRepo.approveAdvance(tx, tenantId, advanceId, { approvedBy: actor.userId, reason, consentId, txnId });
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'labour.advance.approved', entityType: 'worker_advance', entityId: advanceId, reason, ip,
            oldValue: { status: 'requested' }, newValue: { status: 'disbursed', amountMinor: adv.amountMinor.toString(), txnId, consentId, approvedBy: isEmployer ? 'employer' : 'advance.approve' } });
          return { id: advanceId, status: 'disbursed', amountMinor: adv.amountMinor.toString(), txnId };
        } catch (e) { throw namedLabourRefusal(e); }
      }, { userId: actor.userId }));
  }

  async reject(tenantId: string, actor: LabourActor, advanceId: string, reasonRaw: string, ip: string | null) {
    const reason = cleanReason(reasonRaw);
    if (!reason) throw new AdvanceNotAllowedError('a rejection carries a reason (3–300 characters)');
    return this.uow.run(tenantId, async (tx) => {
      const adv = await this.moneyRepo.advanceForUpdate(tx, tenantId, advanceId);
      if (!adv) throw new AdvanceNotFoundError(advanceId);
      const isEmployer = adv.employerUserId === actor.userId && (actor.canBook || actor.canDesk);
      if (!isEmployer && !actor.canApproveAdvance) throw new LabourForbiddenError('rejecting an advance needs the employer or advance.approve');
      let n: number;
      try { n = await this.moneyRepo.rejectAdvance(tx, tenantId, advanceId, actor.userId, reason); } catch (e) { throw namedLabourRefusal(e); }
      if (n !== 1) throw new AdvanceNotAllowedError(`this advance is already ${adv.status}`);
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'labour.advance.rejected', entityType: 'worker_advance', entityId: advanceId, reason, ip,
        oldValue: { status: 'requested' }, newValue: { status: 'rejected' } });
      return { id: advanceId, status: 'rejected' };
    }, { userId: actor.userId });
  }

  private view(a: AdvanceRow) {
    return { id: a.id, assignmentId: a.assignmentId, bookingId: a.bookingId, bookingNo: a.bookingNo ?? null, workerId: a.workerId,
      workerShortName: a.workerName !== undefined ? shortName(a.workerName) : null, workerPhoneMasked: a.workerPhone !== undefined ? maskPhone(a.workerPhone ?? '') : null,
      amountMinor: a.amountMinor.toString(), recoveredMinor: a.recoveredMinor.toString(), outstandingMinor: (a.amountMinor - a.recoveredMinor).toString(),
      expectedWageMinor: a.expectedWageMinor?.toString() ?? null, capMinor: a.expectedWageMinor !== null ? advanceCap(a.expectedWageMinor).toString() : null,
      status: a.status, requestedBy: a.requestedBy, requestReason: a.requestReason, approvedBy: a.approvedBy, approvedAt: a.approvedAt ? new Date(a.approvedAt).toISOString() : null,
      approveReason: a.approveReason, rejectReason: a.rejectReason, disbursalTxnId: a.disbursalTxnId, createdAt: new Date(a.createdAt).toISOString(),
      writeOff: { built: false, reason: 'founder_refused_write_off' } };
  }
  async list(tenantId: string, actor: LabourActor, q: { status?: string; bookingId?: string; cursor?: Cursor; limit: number }) {
    const oversee = canOverseeLabour(actor) || !!actor.canApproveAdvance;
    if (!oversee && !actor.canBook) throw new LabourForbiddenError('requires labour.desk, booking.manage, advance.approve or worker.book');
    const rows = await this.moneyRepo.listAdvances(tenantId, { status: q.status, bookingId: q.bookingId, employerUserId: oversee ? undefined : actor.userId, cursor: q.cursor, limit: q.limit });
    const last = rows[rows.length - 1];
    return { items: rows.map((r) => this.view(r)), nextCursor: rows.length === q.limit && last ? encodeCursor(last.createdAtRaw, last.id) : null,
      totals: oversee ? await this.moneyRepo.advanceTotals(tenantId) : null };
  }
  /** The form's cap preview for one assignment (the database re-judges at the act). */
  async capFor(tenantId: string, actor: LabourActor, assignmentId: string) {
    return this.uow.run(tenantId, async (tx) => {
      const a = await this.assignments.getForUpdate(tx, tenantId, assignmentId);
      if (!a) throw new AssignmentNotFoundError(assignmentId);
      const booking = await this.bookings.getById(tenantId, a.bookingId, tx);
      if (!booking) throw new BookingNotFoundError(a.bookingId);
      if (booking.employerUserId !== actor.userId && !actor.canDesk && !actor.canManage && !actor.canApproveAdvance) throw new AssignmentNotFoundError(assignmentId);
      const b = booking.toProps();
      const expected = expectedForAssignment(b.wageKind, a.wageMinor, plannedDays(b.startDate, b.endDate), b.dailyHours);
      return { assignmentId, expectedWageMinor: expected.toString(), capMinor: advanceCap(expected).toString(), rule: 'all advances on one job ≤ 50% of the expected wage' };
    }, { userId: actor.userId });
  }
}
