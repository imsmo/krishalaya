// modules/education/services/lesson-progress.service.ts · record per-lesson progress + recompute completion.
// Learner-owned (a non-owner enrollment 404s — no IDOR). The lesson must belong to the enrollment's course
// (anti-IDOR across courses). progress_pct is recomputed from distinct completed lessons; reaching 100 stamps
// completed_at + emits CourseCompleted exactly once (idempotent).
import { Inject, Injectable, Optional } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { LessonProgress } from '../domain/lesson-progress.entity';
import { DomainEvent } from '../domain/education.events';
import { EnrollmentRepository } from '../repositories/enrollment.repository';
import { LessonProgressRepository } from '../repositories/lesson-progress.repository';
import { CourseLessonRepository } from '../repositories/course-lesson.repository';
import { MarkProgressDto } from '../dto/mark-lesson-progress.dto';
import { EnrollmentNotFoundError, LessonNotFoundError } from '../domain/education.errors';
import { EducationActor } from './instructor.service';
import { uuidv7 } from '../../../core/database/uuid.util';
import { AppError } from '../../../shared/errors/app-error';
import { readQuiz, quizWellFormed, scoreQuiz } from '../domain/quiz';
import { captureAnswers, checkWatchInterval, progressDelta } from '../domain/learner-insights';
import { LearnerInsightsRepository } from '../repositories/learner-insights.repository';

/** The learner app's own pass mark when a lesson carries none (mobile `QUIZ_PASS_PCT`, named in 7b) — used ONLY to score a capture. */
const DEFAULT_PASS_PCT = 60;
class CaptureRefusedError extends AppError { constructor(code: string, message: string) { super(code, message, 422, { code }); } }

@Injectable()
export class LessonProgressService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly enrollments: EnrollmentRepository,
    private readonly progress: LessonProgressRepository,
    private readonly lessons: CourseLessonRepository,
    // [PC-56 TENANT-SW-f] the W417 capture — optional + last so a positional construction elsewhere keeps compiling; Nest injects it
    @Optional() private readonly capture?: LearnerInsightsRepository,
  ) {}

  async mark(tenantId: string, actor: EducationActor, enrollmentId: string, lessonId: string, dto: MarkProgressDto) {
    return timed(this.metrics, 'education.lesson.progress', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const enrollment = await this.enrollments.getForUpdate(tx, tenantId, enrollmentId);
        if (!enrollment || enrollment.learnerUserId !== actor.userId) throw new EnrollmentNotFoundError(enrollmentId);   // 404, no IDOR
        const courseLessons = await this.lessons.listForCourse(tenantId, enrollment.courseId, tx);
        const lesson = courseLessons.find((l) => l.id === lessonId);
        if (!lesson) throw new LessonNotFoundError(lessonId);   // lesson not in this course
        // [PC-56 TENANT-SW-f · W417] THE CAPTURE — in THIS transaction, so an answer or a watch interval exists iff its progress write does
        let quizScore = dto.quizScore ?? null;
        let captured: { attemptId: string; questions: number; correct: number } | null = null;
        let watched: { seconds: number; source: 'client_interval' | 'progress_delta' } | null = null;
        if (this.capture) {
          const now = new Date();
          const previous = await this.capture.previousSeconds(tx, enrollmentId, lessonId);
          if (dto.answers) {
            const lp0 = lesson.toProps();
            const doc = lp0.contentKind === 'quiz' ? readQuiz(lp0.quiz) : null;
            if (!doc || !quizWellFormed(doc)) throw new CaptureRefusedError('QUIZ_ANSWERS_NOT_A_QUIZ', 'Answers are captured only on a quiz lesson with a well-formed question set');
            if (dto.answers.length > doc.questions.length) throw new CaptureRefusedError('QUIZ_ANSWERS_TOO_MANY', 'More answers than the quiz has questions');
            const rows = captureAnswers(doc, dto.answers);
            const attemptId = uuidv7();
            await this.capture.insertAnswers(tx, { tenantId, enrollmentId, courseId: enrollment.courseId, lessonId, attemptId, learnerUserId: actor.userId, rows });
            const score = scoreQuiz(doc, dto.answers, lp0.quizPassingPct ?? DEFAULT_PASS_PCT);
            quizScore = score.scorePct;    // the server's integer score of the captured answers, not a number the client sent
            captured = { attemptId, questions: rows.length, correct: score.correct };
          }
          if (dto.watch) {
            const started = new Date(dto.watch.startedAt); const ended = new Date(dto.watch.endedAt);
            const v = checkWatchInterval(started, ended, now);
            if (!v.ok) throw new CaptureRefusedError(v.code, 'The watch interval is not a played interval of the last 24 hours');
            await this.capture.insertWatch(tx, { tenantId, enrollmentId, courseId: enrollment.courseId, lessonId, learnerUserId: actor.userId, startedAt: started, endedAt: ended, seconds: v.seconds, source: 'client_interval' });
            watched = { seconds: v.seconds, source: 'client_interval' };
          } else {
            const delta = progressDelta(previous, dto.secondsWatched);
            if (delta > 0) {
              await this.capture.insertWatch(tx, { tenantId, enrollmentId, courseId: enrollment.courseId, lessonId, learnerUserId: actor.userId,
                startedAt: new Date(now.getTime() - delta * 1000), endedAt: now, seconds: delta, source: 'progress_delta' });
              watched = { seconds: delta, source: 'progress_delta' };
            }
          }
        }
        const lp = LessonProgress.record({ enrollmentId, lessonId, secondsWatched: dto.secondsWatched, quizScore, completed: dto.completed });
        await this.progress.upsert(tx, lp);
        const completed = await this.progress.countCompleted(tx, enrollmentId);
        enrollment.recompute(completed, courseLessons.length);
        await this.enrollments.update(tx, enrollment);
        const evts: DomainEvent[] = [...lp.pullEvents(), ...enrollment.pullEvents()];
        for (const e of evts) await this.outbox.write(tx, { tenantId, aggregateType: 'enrollment', aggregateId: enrollmentId, eventType: e.type, payload: { v: 1, ...e.payload } });
        return { lesson: lp.toJSON(), enrollment: enrollment.toJSON(), ...(captured || watched ? { capture: { quiz: captured, watch: watched } } : {}) };
      }, { userId: actor.userId }));
  }
  async listForEnrollment(tenantId: string, actor: EducationActor, enrollmentId: string) {
    const e = await this.enrollments.getByIdForLearner(tenantId, actor.userId, enrollmentId);
    if (!e) throw new EnrollmentNotFoundError(enrollmentId);
    return (await this.progress.listForEnrollment(tenantId, enrollmentId)).map((lp) => lp.toJSON());
  }
}
