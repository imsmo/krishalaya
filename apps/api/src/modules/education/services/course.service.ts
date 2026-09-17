// modules/education/services/course.service.ts · course authoring + lifecycle. The LESSON record is lesson.service.ts
// (PC-56 TENANT-7b); this service asks it for W416's gate.
// One ACID tx per write (UoW), outbox in-tx (Law 4). authz THROWS (Law 6): only the course's OWN instructor may
// edit/add lessons (anti-IDOR); publishing needs course.publish. price_minor is bigint minor units (Law 2).
//
// PC-56 TENANT-7a — THE COURSE RECORD & THE DESK. Three things changed here and each is a rule that used to live
// nowhere or in the wrong place:
//   1. THE REVIEW AND THE WRITE ARE ONE FUNCTION. `preview` and `create`/`update` both call `reviewCourse` over the same
//      facts (registry topic, media asset, tenant currency, the row as it stands); a write is refused with the review's
//      own codes (`CourseFormRefusedError`) when the review is not ready. So a review that said `ready` cannot be
//      followed by a failure screen, and the money gate (a paid course or a price change needs the desk's key) is
//      enforced by the act and not only shown by the review.
//   2. THE CURRENCY IS THE TENANT'S. `create` wrote `currencyCode: 'INR'` for every course on the platform — a course
//      authored by a cooperative in Dubai was priced in rupees (Rule Zero: blocks a country). It is resolved from the
//      tenant's country now, and a tenant whose currency has no scale is REFUSED (`CURRENCY_UNKNOWN`, 6e-1's finding).
//   3. EVERY ACT IS AUDITED WITH A REASON, and each act's verdict (`actVerdict`) is computed before the act by the same
//      function the confirm screen asks, in the order permission → owner → stage → gate → maker-checker. Publish is
//      the desk's act: the instructor and the submitter are refused (`MAKER_IS_CHECKER`) — and 0170's trigger is the
//      wall behind that door.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AUDIT_WRITER, AuditWriter } from '../../../core/audit/audit.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { uuidv7 } from '../../../core/database/uuid.util';
import { ReviewResult, submittedValues, writerIssuesOf, looksLikeId } from '../../../shared/form-review';
import { Course } from '../domain/course.entity';
import { DomainEvent } from '../domain/education.events';
import { CourseRepository, CourseStats, DeskSummary } from '../repositories/course.repository';
import { CourseLessonRepository } from '../repositories/course-lesson.repository';
import { InstructorRepository } from '../repositories/instructor.repository';
import { CourseFormDto, CourseWriterSchema, PreviewCourseDto } from '../dto/create-course.dto';
import { CourseNotFoundError, EducationForbiddenError, CourseFormRefusedError, CourseActRefusedError } from '../domain/education.errors';
import { CourseReviewInput, CurrentCourse, reviewCourse, storedCourse } from '../domain/course-review';
import { CourseAct, ActVerdict, actVerdict, allVerdicts, isCourseAct } from '../domain/course-acts';
import { GateResult } from '../domain/course-publish-gate';
import { LessonService } from './lesson.service';
import { EducationActor } from './instructor.service';

const DESK_WINDOW_DAYS = 30;   // W178: "(30d)" on three of its four tiles

@Injectable()
export class CourseService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly repo: CourseRepository,
    private readonly lessons: CourseLessonRepository,
    private readonly instructors: InstructorRepository,
    private readonly lessonsSvc: LessonService,
  ) {}

  /* ---- THE FORM: review and write, one function ------------------------------------------------------------ */

  /** The chain's review step. Writes nothing; takes no idempotency key — a question asked twice is the same question. */
  async preview(tenantId: string, actor: EducationActor, dto: PreviewCourseDto): Promise<ReviewResult> {
    if (!actor.canAuthor && !actor.canPublish) throw new EducationForbiddenError('requires course.author');
    const { id, ...form } = dto;
    return this.uow.run(tenantId, async (tx) => {
      const input = await this.reviewInput(tx, tenantId, actor, form, id ?? null);
      return reviewCourse(input.review);
    }, { userId: actor.userId });
  }

  async create(tenantId: string, actor: EducationActor, idemKey: string, dto: CourseFormDto, ip: string | null) {
    if (!actor.canAuthor) throw new EducationForbiddenError('requires course.author');
    return this.idem.remember(idemKey, actor.userId, 'education.course.create', () =>
      timed(this.metrics, 'education.course.create', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const { review, topicId } = await this.reviewInput(tx, tenantId, actor, dto, null);
          const stored = storedCourse(review, topicId);
          if (!stored) throw new CourseFormRefusedError(reviewCourse(review).refusals);
          const instructor = await this.instructors.findByUser(tenantId, actor.userId, tx);
          if (!instructor) throw new CourseFormRefusedError([{ field: null, code: 'NO_INSTRUCTOR_PROFILE' }]);
          const c = Course.create({ id: uuidv7(), tenantId, instructorId: instructor.id, defaultTitle: stored.defaultTitle, topicId: stored.topicId,
            audienceRoleIds: [], level: stored.level, priceMinor: BigInt(stored.priceMinor), currencyCode: stored.currencyCode, certEnabled: stored.certEnabled, coverMediaId: stored.coverMediaId });
          await this.repo.insert(tx, c, tenantId, actor.userId);
          // Re-read through the registry join so the response carries the topic's code and name, as every other read does.
          const written = (await this.repo.getById(tenantId, c.id, tx)) ?? c;
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'education.course.create', entityType: 'course', entityId: c.id, newValue: written.toJSON(), ip });
          return written.toJSON();
        }, { userId: actor.userId })));
  }

  async update(tenantId: string, actor: EducationActor, idemKey: string, id: string, dto: CourseFormDto, ip: string | null) {
    if (!actor.canAuthor && !actor.canPublish) throw new EducationForbiddenError('requires course.author');
    return this.idem.remember(idemKey, actor.userId, 'education.course.update', () =>
      this.uow.run(tenantId, async (tx) => {
        const c = await this.repo.getForUpdate(tx, tenantId, id);
        if (!c) throw new CourseNotFoundError(id);
        const { review, topicId } = await this.reviewInput(tx, tenantId, actor, dto, id, c);
        const stored = storedCourse(review, topicId);
        if (!stored) throw new CourseFormRefusedError(reviewCourse(review).refusals);
        const before = c.toJSON();
        c.update({ defaultTitle: stored.defaultTitle, topicId: stored.topicId, level: stored.level, priceMinor: BigInt(stored.priceMinor), currencyCode: stored.currencyCode, certEnabled: stored.certEnabled, coverMediaId: stored.coverMediaId });
        await this.repo.update(tx, c, tenantId, actor.userId);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'education.course.update', entityType: 'course', entityId: c.id, oldValue: before, newValue: c.toJSON(), ip });
        return c.toJSON();
      }, { userId: actor.userId }));
  }

  /** Every fact the reviewer needs, gathered once so `preview` and the writers cannot disagree about any of them. */
  private async reviewInput(tx: TxContext, tenantId: string, actor: EducationActor, form: CourseFormDto, id: string | null, locked?: Course): Promise<{ review: CourseReviewInput; topicId: string | null }> {
    const body = submittedValues(form as Record<string, unknown>);
    const topic = body.topicCode ? await this.repo.topicByCode(tenantId, body.topicCode, tx) : undefined;
    const cover = body.coverMediaId ? (looksLikeId(body.coverMediaId) && await this.repo.mediaExists(tenantId, body.coverMediaId, tx) ? { id: body.coverMediaId } : null) : undefined;
    const [money, me] = await Promise.all([this.repo.moneyShape(tenantId, tx), this.instructors.findByUser(tenantId, actor.userId, tx)]);
    let current: CurrentCourse | null | undefined = undefined;
    if (id !== null) {
      const c = locked ?? (looksLikeId(id) ? await this.repo.getById(tenantId, id, tx) : null);
      if (!c || c.tenantId === null) current = null;   // a platform course is not a tenant's to edit
      else {
        const owner = await this.instructors.getById(tenantId, c.instructorId, tx);
        const p = c.toProps();
        current = { status: p.status, instructorUserId: owner?.userId ?? null, defaultTitle: p.defaultTitle, topicCode: p.topicCode ?? null, level: p.level, priceMinor: p.priceMinor.toString(), certEnabled: p.certEnabled, coverMediaId: p.coverMediaId };
      }
    }
    return {
      topicId: topic?.id ?? null,
      review: {
        canAuthor: actor.canAuthor, canPublish: actor.canPublish, hasInstructorProfile: me !== null, actorUserId: actor.userId,
        entered: form, topic: topic === undefined ? undefined : topic ? { code: topic.code, name: topic.name } : null, cover, money, current,
        writerIssues: writerIssuesOf(CourseWriterSchema, body),
      },
    };
  }

  /* ---- THE ACTS: verdict, then act -------------------------------------------------------------------------- */

  /** The confirm screen's question and W179/W416's buttons: every act's verdict for this caller on this course. */
  async verdicts(tenantId: string, actor: EducationActor, id: string): Promise<{ course: ReturnType<Course['toJSON']>; gate: GateResult; acts: ActVerdict[]; stats: CourseStats | null }> {
    const c = await this.repo.getById(tenantId, id);
    if (!c) throw new CourseNotFoundError(id);
    if (!actor.canAuthor && !actor.canPublish) throw new EducationForbiddenError('requires course.author');
    const owner = await this.instructors.getById(tenantId, c.instructorId);
    const gate = await this.gateFor(tenantId, c, owner !== null);
    const isOwner = owner?.userId === actor.userId;
    // An author may not read another author's draft (404-shaped, as `assertOwner` has always answered); the desk may.
    if (!isOwner && !actor.canPublish) throw new CourseNotFoundError(id);
    const acts = c.tenantId === null
      ? []   // the platform library is not a tenant's to act on (Law 11)
      : allVerdicts({ status: c.status, canAuthor: actor.canAuthor, canPublish: actor.canPublish, isOwner, isSubmitter: c.submittedBy === actor.userId, gateReady: gate.ready });
    // W179's learners / completion / certificates for THIS course — this tenant's enrolments; null when there are none.
    const stats = (await this.repo.statsFor(tenantId, [c.id])).get(c.id) ?? null;
    return { course: c.toJSON(), gate, acts, stats };
  }

  /** W416's checklist for one course. */
  async gate(tenantId: string, actor: EducationActor, id: string): Promise<GateResult> {
    return (await this.verdicts(tenantId, actor, id)).gate;
  }

  /** W416's gate is computed over the LESSON record — TENANT-7b's service owns that read. */
  private gateFor(tenantId: string, c: Course, hasInstructor: boolean, tx?: TxContext): Promise<GateResult> {
    return this.lessonsSvc.gateFor(tenantId, c, hasInstructor, tx);
  }

  /** The act. The verdict is RE-TAKEN inside the transaction, on the locked row — a confirm screen is not a token. */
  async act(tenantId: string, actor: EducationActor, idemKey: string, id: string, actName: string, reason: string, ip: string | null) {
    if (!isCourseAct(actName)) throw new CourseActRefusedError(actName, ['ILLEGAL_FROM_STATUS']);
    const act: CourseAct = actName;
    return this.idem.remember(idemKey, actor.userId, `education.course.${act}`, () =>
      this.uow.run(tenantId, async (tx) => {
        const c = await this.repo.getForUpdate(tx, tenantId, id);
        if (!c) throw new CourseNotFoundError(id);
        const owner = await this.instructors.getById(tenantId, c.instructorId, tx);
        const isOwner = owner?.userId === actor.userId;
        if (!isOwner && !actor.canPublish) throw new CourseNotFoundError(id);
        const gate = act === 'submit' ? await this.gateFor(tenantId, c, owner !== null, tx) : null;
        const v = actVerdict({ act, status: c.status, canAuthor: actor.canAuthor, canPublish: actor.canPublish, isOwner, isSubmitter: c.submittedBy === actor.userId, gateReady: gate?.ready ?? null, reason });
        if (!v.allowed) throw new CourseActRefusedError(act, v.refusals);
        const before = c.toJSON();
        const now = new Date();
        switch (act) {
          case 'submit': c.submitForReview(actor.userId, now); break;
          case 'publish': c.publish(actor.userId, now); break;
          case 'return': c.returnToDraft(actor.userId, reason, now); break;
          case 'pause': c.pause(); break;
          case 'resume': c.resume(); break;
          case 'archive': c.archive(now); break;
        }
        await this.repo.update(tx, c, tenantId, actor.userId);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: `education.course.${act}`, entityType: 'course', entityId: c.id, oldValue: { status: before.status }, newValue: { status: c.status }, reason, ip });
        await this.flush(tx, tenantId, c.id, c.pullEvents());
        return c.toJSON();
      }, { userId: actor.userId }));
  }

  /* ---- READS ------------------------------------------------------------------------------------------------- */

  async getById(tenantId: string, id: string) {
    const c = await this.repo.getById(tenantId, id);
    if (!c) throw new CourseNotFoundError(id);
    const lessons = await this.lessons.listForCourse(tenantId, id);
    return { ...c.toJSON(), lessons: lessons.map((l) => l.toJSON()) };
  }
  async list(tenantId: string, actor: EducationActor, q: { box: 'browse' | 'mine' | 'all'; topicId?: string; level?: string; status?: string; cursor?: { c: string; id: string }; limit: number; withStats?: boolean }) {
    if (q.box === 'all' && !actor.isAdmin) throw new EducationForbiddenError('requires course.publish');
    let instructorId: string | undefined;
    if (q.box === 'mine') { const me = await this.instructors.findByUser(tenantId, actor.userId); if (!me) return { items: [], nextCursor: null, stats: {} }; instructorId = me.id; }
    const rows = await this.repo.listFor(tenantId, { box: q.box, instructorId, topicId: q.topicId, level: q.level, status: q.status, cursor: q.cursor, limit: q.limit });
    const items = rows.map((c) => c.toJSON());
    const last = items[items.length - 1] as any;
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${last.createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    // W178's Learners / Completion columns — for THIS page's rows, and only when the caller may see the desk.
    let stats: Record<string, CourseStats> = {};
    if (q.withStats && (actor.isAdmin || q.box === 'mine')) {
      const m = await this.repo.statsFor(tenantId, items.map((i) => i.id));
      stats = Object.fromEntries([...m.entries()]);
    }
    return { items, nextCursor, stats };
  }
  /** W178's tiles and chips. Desk only. */
  async desk(tenantId: string, actor: EducationActor): Promise<DeskSummary & { windowDays: number; topics: Array<{ id: string; code: string; name: string }> }> {
    if (!actor.isAdmin) throw new EducationForbiddenError('requires course.publish');
    const since = new Date(Date.now() - DESK_WINDOW_DAYS * 86_400_000);
    const [summary, topics] = await Promise.all([this.repo.deskSummary(tenantId, since), this.repo.topics(tenantId)]);
    return { ...summary, windowDays: DESK_WINDOW_DAYS, topics };
  }
  async topics(tenantId: string) { return this.repo.topics(tenantId); }
  async moneyShape(tenantId: string) { return this.repo.moneyShape(tenantId); }

  private async flush(tx: TxContext, tenantId: string | null, id: string, evts: DomainEvent[]): Promise<void> {
    for (const e of evts) await this.outbox.write(tx, { tenantId, aggregateType: 'course', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
