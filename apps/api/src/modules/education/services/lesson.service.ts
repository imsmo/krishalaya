// modules/education/services/lesson.service.ts · PC-56 TENANT-7b · THE LESSON & THE QUIZ — the lesson record behind
// W411 (the outline and the reorder act), W412 (the lesson), W413 (the quiz builder) and their three chains.
//
// THE RULES THIS FILE KEEPS, all 7a's, applied to the lesson:
//   1. THE REVIEW AND THE WRITE ARE ONE FUNCTION. `preview*` and the writers call `reviewLesson` / `reviewSubtitle` /
//      `reviewQuestion` over the same facts (the course as it stands, the lesson as it stands, the media asset in THIS
//      tenant's bucket, the audio twin among THIS course's lessons, the tenant's languages); a write is refused with the
//      review's own codes (`LessonFormRefusedError`) when the review is not ready.
//   2. EVERY ACT IS A VERDICT FIRST. `lessonActVerdict` answers the confirm screen and is re-taken on the locked row.
//   3. EVERY WRITE HAS A KEY AND AN AUDIT ROW. `education.lesson.<create|update|subtitle|question|ready|reopen|move_up|
//      move_down>` on entity `lesson`, with before/after and — for the acts — the reason, in the transaction.
//   4. THE ORDER IS THE DATABASE'S. A move locks the module's rows, plans against the order as it stands, and applies
//      the plan through a negative pass; the same Idempotency-Key replays to the same result and never moves twice.
//
// WHAT IS DECLARED HONESTLY ABOUT VIDEO (W412). `core/media` stores a video (MP4/MOV, ≤ MEDIA_MAX_UPLOAD_BYTES) in S3
// through a presigned PUT and gates it on an antivirus scan (pending → clean | infected | failed); a CLEAN asset is
// served through a presigned GET. There is no transcoding, no audio extraction, no frame extraction and no
// speech-to-text on this platform. So: the audio twin is a SECOND lesson the instructor uploads and pairs; the thumbnail
// is a second into the lesson's own video that the row holds and nothing renders; a subtitle track is text a person
// supplies and marks reviewed. The canon's `queued · processing · ready` maps to the scan and to `ready`, and W412's
// *"Retry"* is refused by name (lesson-acts.ts).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AUDIT_WRITER, AuditWriter } from '../../../core/audit/audit.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { uuidv7 } from '../../../core/database/uuid.util';
import { ReviewResult, submittedValues, writerIssuesOf, looksLikeId } from '../../../shared/form-review';
import { Course } from '../domain/course.entity';
import { CourseLesson } from '../domain/course-lesson.entity';
import { CourseRepository } from '../repositories/course.repository';
import { CourseLessonRepository, LessonStats, SubtitleRow } from '../repositories/course-lesson.repository';
import { InstructorRepository } from '../repositories/instructor.repository';
import { CourseNotFoundError, EducationForbiddenError, LessonActRefusedError, LessonFormRefusedError, LessonNotFoundError } from '../domain/education.errors';
import { EducationActor } from './instructor.service';
import {
  CurrentLesson, LessonReviewInput, MediaFacts, SiblingFacts, SubtitleReviewInput, lessonFormValues, reviewLesson, reviewSubtitle, storedLesson, storedSubtitle,
} from '../domain/lesson-review';
import { LessonFormDto, LessonWriterSchema, SubtitleFormDto, SubtitleWriterSchema, QuestionFormDto, QuestionWriterSchema } from '../dto/create-course-lesson.dto';
import { GateResult, computeGate, isHollow } from '../domain/course-publish-gate';
import { LessonAct, LessonActVerdict, allLessonVerdicts, isLessonAct, lessonActVerdict } from '../domain/lesson-acts';
import { planMove, positionOf } from '../domain/lesson-reorder';
import { QuestionReviewInput, missingExplanations, readQuiz, reviewQuestion, storedQuestion } from '../domain/quiz';

/** What the outline (W411) and the record (W412/W413) print per lesson beyond the row itself. */
export interface LessonView {
  lesson: ReturnType<CourseLesson['toJSON']>;
  position: number;
  /** language code → track status, for the lessons that carry speech. */
  subtitles: Record<string, 'draft' | 'reviewed'>;
  stats: LessonStats | null;
}
export interface OutlineView { course: ReturnType<Course['toJSON']>; lessons: LessonView[]; languages: string[]; canEdit: boolean; gate: GateResult }
export interface LessonRecordView extends LessonView {
  course: ReturnType<Course['toJSON']>;
  moduleSize: number;
  media: MediaFacts | null;
  sibling: { id: string; defaultTitle: string } | null;
  /** For an AUDIO lesson: the video it is the twin of. */
  pairedWith: { id: string; defaultTitle: string } | null;
  tracks: Array<Omit<SubtitleRow, 'body'> & { bodyLength: number }>;
  languages: string[];
  acts: LessonActVerdict[];
  canEdit: boolean;
  quiz: { questions: number; missingExplanations: Array<{ question: number; option: number }> } | null;
  /** The audio lessons of this course, for the form's twin select. */
  audioLessons: Array<{ id: string; defaultTitle: string; position: string; pairedWith: string | null }>;
  form: Record<string, string>;
}

@Injectable()
export class LessonService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly courses: CourseRepository,
    private readonly lessons: CourseLessonRepository,
    private readonly instructors: InstructorRepository,
  ) {}

  /* ---- THE GATE (shared with CourseService — W416 asks it about the lesson record) ---------------------------- */

  async gateFor(tenantId: string, c: Course, hasInstructor: boolean, tx?: TxContext): Promise<GateResult> {
    const [lessons, subs, languages] = await Promise.all([
      this.lessons.listForCourse(tenantId, c.id, tx), this.lessons.listSubtitlesForCourse(tenantId, c.id, tx), this.lessons.languagesFor(tenantId, tx),
    ]);
    const reviewed = new Map<string, Set<string>>();
    for (const s of subs) if (s.status === 'reviewed') { if (!reviewed.has(s.lessonId)) reviewed.set(s.lessonId, new Set()); reviewed.get(s.lessonId)!.add(s.languageCode); }
    const p = c.toProps();
    return computeGate({
      lessons: lessons.map((l) => { const x = l.toProps(); return { id: x.id, moduleNo: x.moduleNo, lessonNo: x.lessonNo, defaultTitle: x.defaultTitle, contentKind: x.contentKind, mediaId: x.mediaId, body: x.body, quiz: x.quiz, status: x.status, siblingLessonId: x.siblingLessonId, thumbnailFrameSecs: x.thumbnailFrameSecs, durationSecs: x.durationSecs, quizPassingPct: x.quizPassingPct }; }),
      reviewedSubtitles: reviewed, languages,
      topicCode: p.topicCode ?? null, priceMinor: p.priceMinor.toString(), currencyCode: p.currencyCode, certEnabled: p.certEnabled, hasInstructor,
    });
  }

  /* ---- READS ------------------------------------------------------------------------------------------------- */

  /** W411. Readable by whoever can read the course; `canEdit` says whether the acts are theirs. */
  async outline(tenantId: string, actor: EducationActor, courseId: string): Promise<OutlineView> {
    const c = await this.courses.getById(tenantId, courseId);
    if (!c) throw new CourseNotFoundError(courseId);
    const owner = await this.instructors.getById(tenantId, c.instructorId);
    const [lessons, subs, languages, stats] = await Promise.all([
      this.lessons.listForCourse(tenantId, c.id), this.lessons.listSubtitlesForCourse(tenantId, c.id), this.lessons.languagesFor(tenantId), this.lessons.statsForCourse(tenantId, c.id),
    ]);
    const gate = await this.gateFor(tenantId, c, owner !== null);
    return { course: c.toJSON(), lessons: this.views(lessons, subs, stats), languages, canEdit: this.canEdit(actor, c, owner?.userId ?? null), gate };
  }

  /** W412 / W413. */
  async record(tenantId: string, actor: EducationActor, courseId: string, lessonId: string): Promise<LessonRecordView> {
    const c = await this.courses.getById(tenantId, courseId);
    if (!c) throw new CourseNotFoundError(courseId);
    const owner = await this.instructors.getById(tenantId, c.instructorId);
    const [lessons, subs, languages, stats] = await Promise.all([
      this.lessons.listForCourse(tenantId, c.id), this.lessons.listSubtitlesForCourse(tenantId, c.id), this.lessons.languagesFor(tenantId), this.lessons.statsForCourse(tenantId, c.id),
    ]);
    const l = lessons.find((x) => x.id === lessonId);
    if (!l) throw new LessonNotFoundError(lessonId);
    const p = l.toProps();
    const media = p.mediaId ? await this.lessons.mediaFacts(tenantId, p.mediaId) : null;
    const byId = new Map(lessons.map((x) => [x.id, x]));
    const sib = p.siblingLessonId ? byId.get(p.siblingLessonId) : undefined;
    const pairedWith = lessons.find((x) => x.toProps().siblingLessonId === l.id);
    const view = this.views([l], subs, stats)[0];
    const isOwner = owner?.userId === actor.userId;
    const module = lessons.filter((x) => x.toProps().moduleNo === p.moduleNo).map((x) => ({ id: x.id, lessonNo: x.toProps().lessonNo }));
    const doc = p.contentKind === 'quiz' ? readQuiz(p.quiz) : null;
    const missing = missingExplanations(doc);
    const acts = allLessonVerdicts({
      canAuthor: actor.canAuthor, canPublish: actor.canPublish && c.tenantId !== null, isOwner, courseStatus: c.status, lessonStatus: p.status,
      hollow: isHollow(p), mediaScanStatus: media?.scanStatus ?? null,
      quizExplained: p.contentKind !== 'quiz' || (doc !== null && missing.length === 0), quizThresholdSet: p.contentKind !== 'quiz' || p.quizPassingPct !== null,
      position: positionOf(module, l.id) ?? 1, moduleSize: module.length,
    });
    const audioLessons = lessons.filter((x) => x.toProps().contentKind === 'audio').map((x) => {
      const y = x.toProps(); const pw = lessons.find((v) => v.toProps().siblingLessonId === x.id);
      return { id: x.id, defaultTitle: y.defaultTitle, position: `${y.moduleNo}·${y.lessonNo}`, pairedWith: pw?.id ?? null };
    });
    return {
      ...view, course: c.toJSON(), moduleSize: module.length, media,
      sibling: sib ? { id: sib.id, defaultTitle: sib.toProps().defaultTitle } : null,
      pairedWith: pairedWith ? { id: pairedWith.id, defaultTitle: pairedWith.toProps().defaultTitle } : null,
      tracks: subs.filter((s) => s.lessonId === l.id).map(({ body, ...rest }) => ({ ...rest, bodyLength: body.length })),
      languages, acts, canEdit: this.canEdit(actor, c, owner?.userId ?? null),
      quiz: p.contentKind === 'quiz' ? { questions: doc?.questions.length ?? 0, missingExplanations: missing } : null,
      audioLessons, form: lessonFormValues(this.current(l)),
    };
  }

  /* ---- THE LESSON FORM: review and write, one function ---------------------------------------------------------- */

  async preview(tenantId: string, actor: EducationActor, courseId: string, dto: LessonFormDto & { lessonId?: string }): Promise<ReviewResult> {
    if (!actor.canAuthor && !actor.canPublish) throw new EducationForbiddenError('requires course.author');
    const { lessonId, ...form } = dto;
    return this.uow.run(tenantId, async (tx) => reviewLesson((await this.reviewInput(tx, tenantId, actor, courseId, form, lessonId ?? null))), { userId: actor.userId });
  }

  async create(tenantId: string, actor: EducationActor, idemKey: string, courseId: string, dto: LessonFormDto, ip: string | null) {
    if (!actor.canAuthor && !actor.canPublish) throw new EducationForbiddenError('requires course.author');
    return this.idem.remember(idemKey, actor.userId, 'education.lesson.create', () =>
      timed(this.metrics, 'education.lesson.create', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const c = await this.courses.getForUpdate(tx, tenantId, courseId);
          if (!c) throw new CourseNotFoundError(courseId);
          const input = await this.reviewInput(tx, tenantId, actor, courseId, dto, null, c);
          const stored = storedLesson(input);
          if (!stored) throw new LessonFormRefusedError(reviewLesson(input).refusals);
          const l = CourseLesson.create({ id: uuidv7(), courseId, moduleNo: stored.moduleNo, lessonNo: stored.lessonNo, defaultTitle: stored.defaultTitle, contentKind: stored.contentKind,
            mediaId: stored.mediaId, body: stored.body, durationSecs: stored.durationSecs, quiz: null, siblingLessonId: stored.siblingLessonId, thumbnailFrameSecs: stored.thumbnailFrameSecs, chapters: stored.chapters, quizPassingPct: null });
          await this.lessons.insert(tx, l, actor.userId);
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'education.lesson.create', entityType: 'lesson', entityId: l.id, newValue: l.toJSON(), ip });
          return l.toJSON();
        }, { userId: actor.userId })));
  }

  async update(tenantId: string, actor: EducationActor, idemKey: string, courseId: string, lessonId: string, dto: LessonFormDto, ip: string | null) {
    if (!actor.canAuthor && !actor.canPublish) throw new EducationForbiddenError('requires course.author');
    return this.idem.remember(idemKey, actor.userId, 'education.lesson.update', () =>
      this.uow.run(tenantId, async (tx) => {
        const c = await this.courses.getForUpdate(tx, tenantId, courseId);
        if (!c) throw new CourseNotFoundError(courseId);
        const l = await this.lessons.getForUpdate(tx, tenantId, courseId, lessonId);
        if (!l) throw new LessonNotFoundError(lessonId);
        const input = await this.reviewInput(tx, tenantId, actor, courseId, dto, lessonId, c, l);
        const stored = storedLesson(input);
        if (!stored) throw new LessonFormRefusedError(reviewLesson(input).refusals);
        const before = l.toJSON();
        l.updateContent({ defaultTitle: stored.defaultTitle, contentKind: stored.contentKind, mediaId: stored.mediaId, body: stored.body, durationSecs: stored.durationSecs, siblingLessonId: stored.siblingLessonId, thumbnailFrameSecs: stored.thumbnailFrameSecs, chapters: stored.chapters });
        await this.lessons.update(tx, l, actor.userId);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'education.lesson.update', entityType: 'lesson', entityId: l.id, oldValue: before, newValue: l.toJSON(), ip });
        return l.toJSON();
      }, { userId: actor.userId }));
  }

  /** Every fact the lesson reviewer needs, gathered once so `preview` and the writers cannot disagree. */
  private async reviewInput(tx: TxContext, tenantId: string, actor: EducationActor, courseId: string, form: LessonFormDto, lessonId: string | null, locked?: Course, lockedLesson?: CourseLesson): Promise<LessonReviewInput> {
    const body = submittedValues(form as Record<string, unknown>);
    const c = locked ?? (looksLikeId(courseId) ? await this.courses.getById(tenantId, courseId, tx) : null);
    const ours = c !== null && c.tenantId !== null;   // a platform course is not a tenant's to edit
    const owner = ours ? await this.instructors.getById(tenantId, c!.instructorId, tx) : null;
    let current: CurrentLesson | null | undefined = undefined;
    if (lessonId !== null) {
      const l = lockedLesson ?? (ours && looksLikeId(lessonId) ? await this.lessons.getById(tenantId, courseId, lessonId, tx) : null);
      current = l ? this.current(l) : null;
    }
    const media = body.mediaId ? (looksLikeId(body.mediaId) ? await this.lessons.mediaFacts(tenantId, body.mediaId, tx) : null) : undefined;
    let sibling: SiblingFacts | null | undefined = undefined;
    if (body.siblingLessonId) {
      const s = ours && looksLikeId(body.siblingLessonId) ? await this.lessons.getById(tenantId, courseId, body.siblingLessonId, tx) : null;
      sibling = s ? { id: s.id, contentKind: s.contentKind, defaultTitle: s.toProps().defaultTitle, pairedWith: await this.lessons.pairedWith(tx, s.id) } : null;
    }
    // On a create: the next number in the module named (default 1). The module's rows are locked so two adds in the
    // same second take two numbers.
    let nextLessonNo = 1;
    if (lessonId === null && ours) {
      const m = /^\d{1,3}$/.test(body.moduleNo ?? '') ? Number(body.moduleNo) : 1;
      const rows = locked ? await this.lessons.listModuleForUpdate(tx, tenantId, courseId, m) : (await this.lessons.listForCourse(tenantId, courseId, tx)).filter((x) => x.toProps().moduleNo === m);
      nextLessonNo = rows.reduce((mx, x) => Math.max(mx, x.toProps().lessonNo), 0) + 1;
    }
    return {
      canAuthor: actor.canAuthor, canPublish: actor.canPublish && ours, isOwner: owner?.userId === actor.userId,
      course: ours ? { status: c!.status } : null, current, nextLessonNo, entered: form, media, sibling,
      writerIssues: writerIssuesOf(LessonWriterSchema, body),
    };
  }

  /* ---- THE SUBTITLE TRACK ------------------------------------------------------------------------------------- */

  async previewSubtitle(tenantId: string, actor: EducationActor, courseId: string, lessonId: string, dto: SubtitleFormDto): Promise<ReviewResult> {
    if (!actor.canAuthor && !actor.canPublish) throw new EducationForbiddenError('requires course.author');
    return this.uow.run(tenantId, async (tx) => reviewSubtitle(await this.subtitleInput(tx, tenantId, actor, courseId, lessonId, dto)), { userId: actor.userId });
  }
  async saveSubtitle(tenantId: string, actor: EducationActor, idemKey: string, courseId: string, lessonId: string, dto: SubtitleFormDto, ip: string | null) {
    if (!actor.canAuthor && !actor.canPublish) throw new EducationForbiddenError('requires course.author');
    return this.idem.remember(idemKey, actor.userId, 'education.lesson.subtitle', () =>
      this.uow.run(tenantId, async (tx) => {
        const c = await this.courses.getForUpdate(tx, tenantId, courseId);
        if (!c) throw new CourseNotFoundError(courseId);
        const l = await this.lessons.getForUpdate(tx, tenantId, courseId, lessonId);
        if (!l) throw new LessonNotFoundError(lessonId);
        const input = await this.subtitleInput(tx, tenantId, actor, courseId, lessonId, dto, c, l);
        const stored = storedSubtitle(input);
        if (!stored) throw new LessonFormRefusedError(reviewSubtitle(input).refusals);
        const before = input.current ? { languageCode: stored.languageCode, status: input.current.status, bodyLength: input.current.body.length } : undefined;
        await this.lessons.upsertSubtitle(tx, uuidv7(), l.id, stored.languageCode, stored.body, stored.reviewed, actor.userId);
        const after = { languageCode: stored.languageCode, status: stored.reviewed ? 'reviewed' : 'draft', bodyLength: stored.body.length };
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'education.lesson.subtitle', entityType: 'lesson', entityId: l.id, oldValue: before, newValue: after, ip });
        return after;
      }, { userId: actor.userId }));
  }
  private async subtitleInput(tx: TxContext, tenantId: string, actor: EducationActor, courseId: string, lessonId: string, form: SubtitleFormDto, locked?: Course, lockedLesson?: CourseLesson): Promise<SubtitleReviewInput> {
    const body = submittedValues(form as Record<string, unknown>);
    const c = locked ?? (looksLikeId(courseId) ? await this.courses.getById(tenantId, courseId, tx) : null);
    const ours = c !== null && c.tenantId !== null;
    const owner = ours ? await this.instructors.getById(tenantId, c!.instructorId, tx) : null;
    const l = lockedLesson ?? (ours && looksLikeId(lessonId) ? await this.lessons.getById(tenantId, courseId, lessonId, tx) : null);
    const languages = await this.lessons.languagesFor(tenantId, tx);
    const current = l && body.languageCode ? await this.lessons.getSubtitle(tx, l.id, body.languageCode) : null;
    return {
      canAuthor: actor.canAuthor, canPublish: actor.canPublish && ours, isOwner: owner?.userId === actor.userId,
      lesson: l && c ? { contentKind: l.contentKind, status: l.status, courseStatus: c.status } : null,
      languages, current: current ? { body: current.body, status: current.status } : undefined, entered: form,
      writerIssues: writerIssuesOf(SubtitleWriterSchema, body),
    };
  }

  /* ---- THE QUIZ QUESTION (W413, W2727–W2730) -------------------------------------------------------------------- */

  async previewQuestion(tenantId: string, actor: EducationActor, courseId: string, lessonId: string, questionNo: number, dto: QuestionFormDto): Promise<ReviewResult> {
    if (!actor.canAuthor && !actor.canPublish) throw new EducationForbiddenError('requires course.author');
    return this.uow.run(tenantId, async (tx) => reviewQuestion(await this.questionInput(tx, tenantId, actor, courseId, lessonId, questionNo, dto)), { userId: actor.userId });
  }
  async saveQuestion(tenantId: string, actor: EducationActor, idemKey: string, courseId: string, lessonId: string, questionNo: number, dto: QuestionFormDto, ip: string | null) {
    if (!actor.canAuthor && !actor.canPublish) throw new EducationForbiddenError('requires course.author');
    return this.idem.remember(idemKey, actor.userId, 'education.lesson.question', () =>
      this.uow.run(tenantId, async (tx) => {
        const c = await this.courses.getForUpdate(tx, tenantId, courseId);
        if (!c) throw new CourseNotFoundError(courseId);
        const l = await this.lessons.getForUpdate(tx, tenantId, courseId, lessonId);
        if (!l) throw new LessonNotFoundError(lessonId);
        const input = await this.questionInput(tx, tenantId, actor, courseId, lessonId, questionNo, dto, c, l);
        const stored = storedQuestion(input);
        if (!stored) throw new LessonFormRefusedError(reviewQuestion(input).refusals);
        const before = { quiz: l.toProps().quiz, quizPassingPct: l.toProps().quizPassingPct };
        l.setQuiz(stored.doc, stored.passingPct);
        await this.lessons.update(tx, l, actor.userId);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'education.lesson.question', entityType: 'lesson', entityId: l.id, oldValue: before, newValue: { questionNo: stored.questionNo, quiz: stored.doc, quizPassingPct: stored.passingPct }, ip });
        return l.toJSON();
      }, { userId: actor.userId }));
  }
  private async questionInput(tx: TxContext, tenantId: string, actor: EducationActor, courseId: string, lessonId: string, questionNo: number, form: QuestionFormDto, locked?: Course, lockedLesson?: CourseLesson): Promise<QuestionReviewInput> {
    const body = submittedValues(form as Record<string, unknown>);
    const c = locked ?? (looksLikeId(courseId) ? await this.courses.getById(tenantId, courseId, tx) : null);
    const ours = c !== null && c.tenantId !== null;
    const owner = ours ? await this.instructors.getById(tenantId, c!.instructorId, tx) : null;
    const l = lockedLesson ?? (ours && looksLikeId(lessonId) ? await this.lessons.getById(tenantId, courseId, lessonId, tx) : null);
    const p = l?.toProps();
    return {
      canAuthor: actor.canAuthor, canPublish: actor.canPublish && ours, isOwner: owner?.userId === actor.userId,
      lesson: p && c ? { contentKind: p.contentKind, status: p.status, courseStatus: c.status, quiz: readQuiz(p.quiz), passingPct: p.quizPassingPct } : null,
      questionNo, entered: form, writerIssues: writerIssuesOf(QuestionWriterSchema, body),
    };
  }

  /* ---- THE ACTS: verdict, then act --------------------------------------------------------------------------- */

  async act(tenantId: string, actor: EducationActor, idemKey: string, courseId: string, lessonId: string, actName: string, reason: string, ip: string | null) {
    if (!isLessonAct(actName)) throw new LessonActRefusedError(actName, ['ILLEGAL_FROM_STATUS']);
    const act: LessonAct = actName;
    return this.idem.remember(idemKey, actor.userId, `education.lesson.${act}`, () =>
      this.uow.run(tenantId, async (tx) => {
        const c = await this.courses.getForUpdate(tx, tenantId, courseId);
        if (!c) throw new CourseNotFoundError(courseId);
        const owner = await this.instructors.getById(tenantId, c.instructorId, tx);
        const isOwner = owner?.userId === actor.userId;
        if (!isOwner && !actor.canPublish) throw new LessonNotFoundError(lessonId);   // 404-shaped for a probe, as 7a
        const l = await this.lessons.getForUpdate(tx, tenantId, courseId, lessonId);
        if (!l) throw new LessonNotFoundError(lessonId);
        const p = l.toProps();
        const module = (await this.lessons.listModuleForUpdate(tx, tenantId, courseId, p.moduleNo)).map((x) => ({ id: x.id, lessonNo: x.toProps().lessonNo }));
        const media = p.mediaId ? await this.lessons.mediaFacts(tenantId, p.mediaId, tx) : null;
        const doc = p.contentKind === 'quiz' ? readQuiz(p.quiz) : null;
        const v = lessonActVerdict({
          act, canAuthor: actor.canAuthor, canPublish: actor.canPublish, isOwner, courseStatus: c.status, lessonStatus: p.status,
          hollow: isHollow(p), mediaScanStatus: media?.scanStatus ?? null,
          quizExplained: p.contentKind !== 'quiz' || (doc !== null && missingExplanations(doc).length === 0), quizThresholdSet: p.contentKind !== 'quiz' || p.quizPassingPct !== null,
          position: positionOf(module, l.id) ?? 1, moduleSize: module.length, reason,
        });
        if (!v.allowed) throw new LessonActRefusedError(act, v.refusals);
        const now = new Date();
        let before: Record<string, unknown>; let after: Record<string, unknown>;
        if (act === 'ready' || act === 'reopen') {
          before = { status: p.status };
          if (act === 'ready') l.markReady(actor.userId, now); else l.reopen();
          await this.lessons.update(tx, l, actor.userId);
          after = { status: l.status };
        } else {
          const plan = planMove(module, l.id, act === 'move_up' ? 'up' : 'down');
          if (!plan.ok) throw new LessonActRefusedError(act, [plan.refusal === 'AT_TOP' ? 'AT_TOP' : 'AT_BOTTOM']);
          await this.lessons.applyMove(tx, courseId, p.moduleNo, plan.steps, actor.userId);
          const me = plan.steps.find((s) => s.id === l.id);
          before = { moduleNo: p.moduleNo, lessonNo: me?.from ?? p.lessonNo }; after = { moduleNo: p.moduleNo, lessonNo: me?.to ?? p.lessonNo, order: plan.order };
        }
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: `education.lesson.${act}`, entityType: 'lesson', entityId: l.id, oldValue: before, newValue: after, reason, ip });
        const fresh = await this.lessons.getById(tenantId, courseId, l.id, tx);
        return (fresh ?? l).toJSON();
      }, { userId: actor.userId }));
  }

  /* ---- helpers ------------------------------------------------------------------------------------------------ */

  private canEdit(actor: EducationActor, c: Course, ownerUserId: string | null): boolean {
    if (c.tenantId === null || c.status === 'archived') return false;
    return (actor.canAuthor && ownerUserId === actor.userId) || actor.canPublish;
  }
  private current(l: CourseLesson): CurrentLesson {
    const p = l.toProps();
    return { id: p.id, status: p.status, moduleNo: p.moduleNo, lessonNo: p.lessonNo, defaultTitle: p.defaultTitle, contentKind: p.contentKind, mediaId: p.mediaId, body: p.body, durationSecs: p.durationSecs, siblingLessonId: p.siblingLessonId, thumbnailFrameSecs: p.thumbnailFrameSecs, chapters: p.chapters };
  }
  private views(lessons: CourseLesson[], subs: SubtitleRow[], stats: Map<string, LessonStats>): LessonView[] {
    const byModule = new Map<number, Array<{ id: string; lessonNo: number }>>();
    for (const l of lessons) { const p = l.toProps(); if (!byModule.has(p.moduleNo)) byModule.set(p.moduleNo, []); byModule.get(p.moduleNo)!.push({ id: l.id, lessonNo: p.lessonNo }); }
    return lessons.map((l) => {
      const p = l.toProps();
      const subtitles: Record<string, 'draft' | 'reviewed'> = {};
      for (const s of subs) if (s.lessonId === l.id) subtitles[s.languageCode] = s.status;
      return { lesson: l.toJSON(), position: positionOf(byModule.get(p.moduleNo) ?? [], l.id) ?? p.lessonNo, subtitles, stats: stats.get(l.id) ?? null };
    });
  }
}
