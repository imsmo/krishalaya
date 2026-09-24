// modules/education/services/enrollment.service.ts · THE ENROLLMENT MONEY PATH.
// Free course → instant enrollment. Paid course → the learner buys a seat: a ZERO-SUM, idempotent 'course_purchase'
// wallet transfer posted in the SAME tx as the enrollment (Law 2 + Law 4). A learner can't enroll twice (UNIQUE
// course+learner) nor in their own course. authz: enroll needs only auth; reads are learner-owned (404).
//
// PC-56 TENANT-7d-money · THE EARNINGS (0174). Before this wave the legs were `userMain(learner) −price,
// userMain(instructor) +floor(price × royalty_bps), platform fees +remainder` — and `userMain(userId, currencyCode =
// 'INR')` booked EVERY leg in rupees whatever `course.currencyCode` said (a Dubai course posted paise), the TENANT
// received nothing while the canon prints *"Tenant + platform (20%)"*, and nothing recorded the split to sum. Now:
//   • every leg carries `course.currencyCode` (a correction of a false record — not flagged);
//   • the split is resolved by `resolveSplitShares` — behind `course_royalty_split` (OFF = the pre-0174 shape, still in
//     the course's currency): the instructor's ACCEPTED agreement, else the tenant's rule in force (its own active
//     `course_royalty_rules` row, else the platform default), with the instructor's leg HELD in their hold wallet until
//     an agreement is accepted; buyer → instructor (main | hold) · tenant commission · platform fees, netting to zero;
//   • ONE `instructor_royalty_lines` row per paid enrollment records the gross and its three legs, the currency and
//     its scale, the wallet transaction and the leg's state — W418 is a SUM over these lines, never a stored total.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { WALLET_SERVICE, WalletPort, LedgerLeg } from '../../../core/wallet/wallet.port';
import { userMain, userHold, tenantCommission, platform, PlatformAccount } from '../../../core/wallet/account-codes';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { InstructorEarningsRepository } from '../repositories/instructor-earnings.repository';
import { resolveSplitShares, splitRoyalty } from '../domain/royalty-split';
import { uuidv7 } from '../../../core/database/uuid.util';
import { Enrollment } from '../domain/enrollment.entity';
import { DomainEvent, EducationEventType } from '../domain/education.events';
import { isEnrollable } from '../domain/course.state';
import { CourseRepository } from '../repositories/course.repository';
import { InstructorRepository } from '../repositories/instructor.repository';
import { EnrollmentRepository } from '../repositories/enrollment.repository';
import { CourseNotFoundError, CourseNotPublishedError, AlreadyEnrolledError, CannotEnrollOwnCourseError, EnrollmentNotFoundError, InvalidCourseError } from '../domain/education.errors';
import { EducationActor } from './instructor.service';

@Injectable()
export class EnrollmentService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly courses: CourseRepository,
    private readonly instructors: InstructorRepository,
    private readonly enrollments: EnrollmentRepository,
    private readonly earnings: InstructorEarningsRepository,
    private readonly flags: FlagsService,
  ) {}

  /** The flag that turns the rule-resolved split (tenant share, hold) on. Unreadable ⇒ OFF, the pre-0174 shape. */
  static readonly SPLIT_FLAG = 'course_royalty_split';

  async enroll(tenantId: string, actor: EducationActor, courseId: string, idemKey: string) {
    return this.idem.remember(idemKey, actor.userId, 'education.enroll', () =>
      timed(this.metrics, 'education.enroll', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const course = await this.courses.getById(tenantId, courseId, tx);
          if (!course) throw new CourseNotFoundError(courseId);
          if (!isEnrollable(course.status)) throw new CourseNotPublishedError(course.status);
          const instructor = await this.instructors.getById(tenantId, course.instructorId, tx);
          if (instructor && instructor.userId === actor.userId) throw new CannotEnrollOwnCourseError();
          if (await this.enrollments.findByCourseLearner(tenantId, courseId, actor.userId, tx)) throw new AlreadyEnrolledError(courseId);

          const id = uuidv7();
          const enrollment = Enrollment.enroll({ id, tenantId, courseId, learnerUserId: actor.userId, paymentId: null });
          if (!course.isFree) {
            // THE CURRENCY IS THE COURSE'S, AND ITS SCALE IS THE CURRENCY'S OWN (6e-1) — recorded on the line, never assumed.
            const cur = course.currencyCode;
            const minorUnits = await this.earnings.minorUnitsOf(tx, cur);
            if (minorUnits === null) throw new InvalidCourseError(`currency ${cur} has no minor_units on this platform`);
            const flagOn = await this.flags.isEnabled(EnrollmentService.SPLIT_FLAG, { tenantId }).catch(() => false);
            const rule = flagOn ? await this.earnings.ruleInForce(tenantId, tx) : null;
            const agreement = flagOn && instructor ? await this.earnings.acceptedAgreement(tenantId, instructor.id, tx) : null;
            const resolved = resolveSplitShares({
              flagOn, royaltyBps: instructor?.royaltyBps ?? 0,
              rule: rule ? { ruleId: rule.id, instructorBps: rule.instructorShareBps, tenantBps: rule.tenantShareBps, platformBps: rule.platformShareBps } : null,
              agreement: agreement ? { agreementId: agreement.id, instructorBps: agreement.instructorShareBps, tenantBps: agreement.tenantShareBps, platformBps: agreement.platformShareBps } : null,
            });
            const split = splitRoyalty(course.priceMinor, resolved.shares);
            const legs: LedgerLeg[] = [{ account: userMain(actor.userId, cur), amountMinor: -course.priceMinor }];
            if (instructor) {
              if (split.instructorMinor > 0n) legs.push({ account: resolved.leg === 'hold' ? userHold(instructor.userId, cur) : userMain(instructor.userId, cur), amountMinor: split.instructorMinor });
              if (split.tenantMinor > 0n) legs.push({ account: tenantCommission(tenantId, cur), amountMinor: split.tenantMinor });
              if (split.platformMinor > 0n) legs.push({ account: platform(PlatformAccount.Fees, cur), amountMinor: split.platformMinor });
            } else {
              // no instructor row on the course ⇒ nobody to pay a royalty to; the whole price is the platform's (pre-0174 rule, kept and named)
              legs.push({ account: platform(PlatformAccount.Fees, cur), amountMinor: course.priceMinor });
            }
            const posted = await this.wallet.post(tx, { tenantId, txnType: 'course_purchase', idempotencyKey: `coursebuy:${id}`, referenceType: 'enrollment', referenceId: id, initiatedBy: actor.userId, legs });
            const lineId = instructor && !posted.alreadyApplied ? uuidv7() : null;
            enrollment.pullEvents();   // replace the plain Enrolled event with a CoursePurchased + Enrolled pair
            await this.outbox.write(tx, { tenantId, aggregateType: 'enrollment', aggregateId: id, eventType: EducationEventType.CoursePurchased, payload: {
              v: 2, enrollmentId: id, courseId, learnerUserId: actor.userId, currencyCode: cur, minorUnits, priceMinor: course.priceMinor.toString(),
              instructorMinor: instructor ? split.instructorMinor.toString() : '0', tenantMinor: instructor ? split.tenantMinor.toString() : '0',
              platformMinor: instructor ? split.platformMinor.toString() : course.priceMinor.toString(), instructorLeg: instructor ? resolved.state : null, royaltyLineId: lineId, ledgerTxnId: posted.txnId,
            } });
            await this.outbox.write(tx, { tenantId, aggregateType: 'enrollment', aggregateId: id, eventType: EducationEventType.Enrolled, payload: { v: 1, enrollmentId: id, courseId, learnerUserId: actor.userId, paid: true } });
            await this.enrollments.insert(tx, enrollment);
            if (instructor && lineId) {
              await this.earnings.insertLine(tx, {
                id: lineId, tenantId, instructorId: instructor.id, instructorUserId: instructor.userId, courseId, enrollmentId: id, learnerUserId: actor.userId,
                currencyCode: cur, minorUnits, grossMinor: split.grossMinor, instructorMinor: split.instructorMinor, tenantMinor: split.tenantMinor, platformMinor: split.platformMinor,
                instructorShareBps: resolved.shares.instructorBps, tenantShareBps: resolved.shares.tenantBps, platformShareBps: resolved.shares.platformBps,
                ruleId: resolved.ruleId, agreementId: resolved.agreementId, ledgerTxnId: posted.txnId, state: resolved.state,
              }, actor.userId);
            }
            return { ...enrollment.toJSON(), pricePaidMinor: course.priceMinor.toString(), currencyCode: cur };
          }
          await this.enrollments.insert(tx, enrollment);
          if (course.isFree) await this.flush(tx, tenantId, id, enrollment.pullEvents());
          return { ...enrollment.toJSON(), pricePaidMinor: '0', currencyCode: course.currencyCode };
        }, { userId: actor.userId })));
  }

  async getById(tenantId: string, actor: EducationActor, id: string) {
    const e = await this.enrollments.getByIdForLearner(tenantId, actor.userId, id);
    if (!e) throw new EnrollmentNotFoundError(id);   // 404 for a non-owner (no IDOR)
    return e.toJSON();
  }
  async list(tenantId: string, actor: EducationActor, q: { completedOnly?: boolean; cursor?: { c: string; id: string }; limit: number }) {
    const rows = await this.enrollments.listForLearner(tenantId, actor.userId, q);
    const items = rows.map((e) => e.toJSON());
    const last = items[items.length - 1] as any;
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${last.createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }
  private async flush(tx: TxContext, tenantId: string, id: string, evts: DomainEvent[]): Promise<void> {
    for (const e of evts) await this.outbox.write(tx, { tenantId, aggregateType: 'enrollment', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
