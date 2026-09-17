// modules/education/repositories/course-lesson.repository.ts · course_lessons + course_lesson_subtitles.
//
// PC-56 TENANT-7b. Scoped through the course (7a's `libraryVisible`: a tenant's own courses in any status, the platform
// library's PUBLISHED ones) AND, since 0171, by the table's own RLS — the row carries the course's tenant_id, written by a
// trigger. Ordered by (module_no, lesson_no). The PC-26 upsert on UNIQUE(course, module, lesson) is gone: a lesson is
// INSERTed once at the position the review showed, edited by id, and MOVED by the reorder act (`applyMove`), which
// renumbers through a negative pass inside the caller's transaction because the UNIQUE key would otherwise collide
// half-way.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { CourseLesson, LessonChapter } from '../domain/course-lesson.entity';
import { ContentKind } from '../domain/education.events';
import { LessonStatus } from '../domain/lesson.state';
import { MoveStep } from '../domain/lesson-reorder';
import { MediaFacts } from '../domain/lesson-review';

const COLS = `l.id, l.course_id, l.module_no, l.lesson_no, l.default_title, l.content_kind, l.media_id, l.body, l.duration_secs, l.quiz, l.created_at,
  l.status, l.ready_at, l.ready_by, l.sibling_lesson_id, l.thumbnail_frame_secs, l.chapters, l.quiz_passing_pct`;
const VISIBLE = `(c.tenant_id=$2 OR (c.tenant_id IS NULL AND c.status='published')) AND c.deleted_at IS NULL AND l.deleted_at IS NULL`;

function toDomain(r: any): CourseLesson {
  return CourseLesson.rehydrate({
    id: r.id, courseId: r.course_id, moduleNo: r.module_no, lessonNo: r.lesson_no, defaultTitle: r.default_title, contentKind: r.content_kind as ContentKind,
    mediaId: r.media_id, body: r.body, durationSecs: r.duration_secs, quiz: r.quiz, createdAt: r.created_at,
    status: r.status as LessonStatus, readyAt: r.ready_at ?? null, readyBy: r.ready_by ?? null,
    siblingLessonId: r.sibling_lesson_id ?? null, thumbnailFrameSecs: r.thumbnail_frame_secs ?? null,
    chapters: Array.isArray(r.chapters) ? (r.chapters as LessonChapter[]) : [], quizPassingPct: r.quiz_passing_pct ?? null,
  });
}

export interface SubtitleRow { id: string; lessonId: string; languageCode: string; status: 'draft' | 'reviewed'; body: string; reviewedAt: Date | null; reviewedBy: string | null; updatedAt: Date | null }
/** W179/W411: per-lesson learner reality for THIS tenant's enrolments — started (a progress row) and completed. */
export interface LessonStats { lessonId: string; started: number; completed: number }

@Injectable()
export class CourseLessonRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, l: CourseLesson, createdBy: string): Promise<void> {
    const p = l.toProps();
    await tx.query(
      `INSERT INTO course_lessons (id, course_id, module_no, lesson_no, default_title, content_kind, media_id, body, duration_secs, quiz, created_by,
                                   status, sibling_lesson_id, thumbnail_frame_secs, chapters, quiz_passing_pct)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15::jsonb,$16)`,
      [p.id, p.courseId, p.moduleNo, p.lessonNo, p.defaultTitle, p.contentKind, p.mediaId, p.body, p.durationSecs, p.quiz == null ? null : JSON.stringify(p.quiz), createdBy,
       p.status, p.siblingLessonId, p.thumbnailFrameSecs, JSON.stringify(p.chapters), p.quizPassingPct]);
  }
  /** Content, quiz and state — never the position (that is `applyMove`'s). */
  async update(tx: TxContext, l: CourseLesson, updatedBy: string): Promise<void> {
    const p = l.toProps();
    await tx.query(
      `UPDATE course_lessons SET default_title=$2, content_kind=$3, media_id=$4, body=$5, duration_secs=$6, quiz=$7::jsonb,
         status=$8, ready_at=$9, ready_by=$10, sibling_lesson_id=$11, thumbnail_frame_secs=$12, chapters=$13::jsonb, quiz_passing_pct=$14, updated_by=$15, updated_at=now()
       WHERE id=$1 AND deleted_at IS NULL`,
      [p.id, p.defaultTitle, p.contentKind, p.mediaId, p.body, p.durationSecs, p.quiz == null ? null : JSON.stringify(p.quiz),
       p.status, p.readyAt, p.readyBy, p.siblingLessonId, p.thumbnailFrameSecs, JSON.stringify(p.chapters), p.quizPassingPct, updatedBy]);
  }
  async listForCourse(tenantId: string, courseId: string, tx?: TxContext): Promise<CourseLesson[]> {
    const sql = `SELECT ${COLS} FROM course_lessons l JOIN courses c ON c.id=l.course_id WHERE l.course_id=$1 AND ${VISIBLE} ORDER BY l.module_no, l.lesson_no`;
    const r = tx ? await tx.query(sql, [courseId, tenantId]) : await this.replica.forTenant(tenantId).query(sql, [courseId, tenantId]);
    return r.rows.map(toDomain);
  }
  /** The module's rows LOCKED, for the reorder act and the create (which takes the next number). */
  async listModuleForUpdate(tx: TxContext, tenantId: string, courseId: string, moduleNo: number): Promise<CourseLesson[]> {
    const r = await tx.query(`SELECT ${COLS} FROM course_lessons l JOIN courses c ON c.id=l.course_id WHERE l.course_id=$1 AND ${VISIBLE} AND l.module_no=$3 ORDER BY l.module_no, l.lesson_no FOR UPDATE OF l`, [courseId, tenantId, moduleNo]);
    return r.rows.map(toDomain);
  }
  async getById(tenantId: string, courseId: string, lessonId: string, tx?: TxContext): Promise<CourseLesson | null> {
    const sql = `SELECT ${COLS} FROM course_lessons l JOIN courses c ON c.id=l.course_id WHERE l.id=$3 AND l.course_id=$1 AND ${VISIBLE}`;
    const r = tx ? await tx.query(sql, [courseId, tenantId, lessonId]) : await this.replica.forTenant(tenantId).query(sql, [courseId, tenantId, lessonId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getForUpdate(tx: TxContext, tenantId: string, courseId: string, lessonId: string): Promise<CourseLesson | null> {
    const r = await tx.query(`SELECT ${COLS} FROM course_lessons l JOIN courses c ON c.id=l.course_id WHERE l.id=$3 AND l.course_id=$1 AND ${VISIBLE} FOR UPDATE OF l`, [courseId, tenantId, lessonId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async countForCourse(tenantId: string, courseId: string, tx: TxContext): Promise<number> {
    const r = await tx.query(`SELECT count(*)::int n FROM course_lessons l JOIN courses c ON c.id=l.course_id WHERE l.course_id=$1 AND ${VISIBLE}`, [courseId, tenantId]);
    return r.rows[0]?.n ?? 0;
  }
  /** The video already paired with this audio lesson, if any (uq_course_lessons_sibling holds it to one). */
  async pairedWith(tx: TxContext, audioLessonId: string): Promise<string | null> {
    const r = await tx.query(`SELECT id FROM course_lessons WHERE sibling_lesson_id=$1 AND deleted_at IS NULL LIMIT 1`, [audioLessonId]);
    return r.rows[0]?.id ?? null;
  }

  /**
   * THE MOVE, applied. The rows are already locked by `listModuleForUpdate`. Every row in the plan first takes the
   * negative of its target (no two targets collide, so no two negatives do), then the target — two statements in the
   * caller's transaction, never a state where UNIQUE(course, module, lesson) is violated.
   */
  async applyMove(tx: TxContext, courseId: string, moduleNo: number, steps: readonly MoveStep[], updatedBy: string): Promise<void> {
    if (steps.length === 0) return;
    const ids = steps.map((s) => s.id); const targets = steps.map((s) => s.to);
    await tx.query(
      `UPDATE course_lessons l SET lesson_no = -m.t FROM unnest($3::uuid[], $4::int[]) AS m(id, t) WHERE l.id = m.id AND l.course_id=$1 AND l.module_no=$2`,
      [courseId, moduleNo, ids, targets]);
    await tx.query(
      `UPDATE course_lessons l SET lesson_no = m.t, updated_by=$5, updated_at=now() FROM unnest($3::uuid[], $4::int[]) AS m(id, t) WHERE l.id = m.id AND l.course_id=$1 AND l.module_no=$2`,
      [courseId, moduleNo, ids, targets, updatedBy]);
  }

  /* ---- media facts (the lesson's asset, in THIS tenant's bucket) ------------------------------------------------ */
  async mediaFacts(tenantId: string, id: string, tx?: TxContext): Promise<MediaFacts | null> {
    const sql = `SELECT id, kind, scan_status, mime_type, bytes, duration_secs FROM media_assets WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`;
    const r = tx ? await tx.query(sql, [id, tenantId]) : await this.replica.forTenant(tenantId).query(sql, [id, tenantId]);
    const x = r.rows[0];
    return x ? { id: x.id, kind: x.kind, scanStatus: x.scan_status, mimeType: x.mime_type, bytes: String(x.bytes), durationSecs: x.duration_secs ?? null } : null;
  }

  /* ---- subtitles ------------------------------------------------------------------------------------------------ */
  async listSubtitlesForCourse(tenantId: string, courseId: string, tx?: TxContext): Promise<SubtitleRow[]> {
    const sql = `SELECT s.id, s.lesson_id, s.language_code, s.status, s.body, s.reviewed_at, s.reviewed_by, s.updated_at
       FROM course_lesson_subtitles s JOIN course_lessons l ON l.id=s.lesson_id JOIN courses c ON c.id=l.course_id
       WHERE l.course_id=$1 AND ${VISIBLE} AND s.deleted_at IS NULL ORDER BY l.module_no, l.lesson_no, s.language_code`;
    const r = tx ? await tx.query(sql, [courseId, tenantId]) : await this.replica.forTenant(tenantId).query(sql, [courseId, tenantId]);
    return r.rows.map((x: any) => ({ id: x.id, lessonId: x.lesson_id, languageCode: x.language_code, status: x.status, body: x.body, reviewedAt: x.reviewed_at ?? null, reviewedBy: x.reviewed_by ?? null, updatedAt: x.updated_at ?? null }));
  }
  async getSubtitle(tx: TxContext, lessonId: string, languageCode: string): Promise<SubtitleRow | null> {
    const r = await tx.query(`SELECT id, lesson_id, language_code, status, body, reviewed_at, reviewed_by, updated_at FROM course_lesson_subtitles WHERE lesson_id=$1 AND language_code=$2 AND deleted_at IS NULL FOR UPDATE`, [lessonId, languageCode]);
    const x = r.rows[0];
    return x ? { id: x.id, lessonId: x.lesson_id, languageCode: x.language_code, status: x.status, body: x.body, reviewedAt: x.reviewed_at ?? null, reviewedBy: x.reviewed_by ?? null, updatedAt: x.updated_at ?? null } : null;
  }
  /** One row per (lesson, language) — both NOT NULL, so the conflict target can fire (6c-4). */
  async upsertSubtitle(tx: TxContext, id: string, lessonId: string, languageCode: string, body: string, reviewed: boolean, by: string): Promise<void> {
    await tx.query(
      `INSERT INTO course_lesson_subtitles (id, lesson_id, language_code, status, body, reviewed_at, reviewed_by, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (lesson_id, language_code) DO UPDATE SET status=EXCLUDED.status, body=EXCLUDED.body, reviewed_at=EXCLUDED.reviewed_at, reviewed_by=EXCLUDED.reviewed_by, updated_by=$8, updated_at=now()`,
      [id, lessonId, languageCode, reviewed ? 'reviewed' : 'draft', body, reviewed ? new Date() : null, reviewed ? by : null, by]);
  }

  /* ---- the tenant's languages ----------------------------------------------------------------------------------- */
  /** `tenant_languages`, or the platform's active languages when the tenant has declared none. */
  async languagesFor(tenantId: string, tx?: TxContext): Promise<string[]> {
    const run = (sql: string, params: unknown[]) => (tx ? tx.query(sql, params) : this.replica.forTenant(tenantId).query(sql, params));
    const own = await run(`SELECT tl.language_code FROM tenant_languages tl JOIN languages lg ON lg.code=tl.language_code WHERE tl.tenant_id=$1 ORDER BY tl.is_default DESC, lg.sort_order, tl.language_code`, [tenantId]);
    if (own.rows.length > 0) return own.rows.map((x: any) => x.language_code);
    const all = await run(`SELECT code FROM languages WHERE is_active AND deleted_at IS NULL ORDER BY sort_order, code`, []);
    return all.rows.map((x: any) => x.code);
  }

  /* ---- learner reality per lesson (W179's per-lesson completion, named by 7a for this wave) --------------------- */
  async statsForCourse(tenantId: string, courseId: string): Promise<Map<string, LessonStats>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT lp.lesson_id, count(*)::int AS started, count(lp.completed_at)::int AS completed
         FROM lesson_progress lp JOIN enrollments e ON e.id=lp.enrollment_id
        WHERE e.tenant_id=$1 AND e.course_id=$2 AND e.deleted_at IS NULL GROUP BY lp.lesson_id`, [tenantId, courseId]);
    const out = new Map<string, LessonStats>();
    for (const x of r.rows) out.set(x.lesson_id, { lessonId: x.lesson_id, started: x.started, completed: x.completed });
    return out;
  }
}
