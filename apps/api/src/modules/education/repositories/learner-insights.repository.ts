// modules/education/repositories/learner-insights.repository.ts · PC-56 TENANT-SW-f · W417 — the capture writes (quiz_answers,
// watch_events: kv_app INSERT only, append-only by trigger, 0202) and the studio's reads (funnel, per-question misses, seconds by IST
// hour, distinct learners for the floor, when capture began). Tenant in every query (Law 1); reads through the replica (Law 12).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import type { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';
import { US_SQL } from '../../../shared/pagination/us-keyset';

export interface StudioCourseRow { id: string; title: string; status: string; instructorUserId: string | null; enrolled: number; completed: number; createdUs: string }
export interface FunnelRow { lessonId: string; moduleNo: number; lessonNo: number; title: string; kind: string; started: number; completed: number }

@Injectable()
export class LearnerInsightsRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  private db(tenantId: string, tx?: SqlExecutor | null): SqlExecutor { return tx ?? this.replica.forTenant(tenantId); }

  /* ───────── capture (in the progress write's transaction) ───────── */
  async previousSeconds(tx: TxContext, enrollmentId: string, lessonId: string): Promise<number | null> {
    const r = await tx.query<{ s: number }>(`SELECT seconds_watched AS s FROM lesson_progress WHERE enrollment_id = $1 AND lesson_id = $2 FOR UPDATE`, [enrollmentId, lessonId]);
    return r.rows[0] ? Number(r.rows[0].s) : null;
  }
  async insertAnswers(tx: TxContext, a: { tenantId: string; enrollmentId: string; courseId: string; lessonId: string; attemptId: string; learnerUserId: string; rows: Array<{ questionNo: number; chosen: number | null; correct: boolean }> }): Promise<void> {
    if (a.rows.length === 0) return;
    await tx.query(
      `INSERT INTO quiz_answers (tenant_id, enrollment_id, course_id, lesson_id, attempt_id, question_no, learner_user_id, chosen, correct)
       SELECT $1, $2, $3, $4, $5, x.q, $6, x.c, x.ok FROM unnest($7::smallint[], $8::smallint[], $9::boolean[]) AS x(q, c, ok)`,
      [a.tenantId, a.enrollmentId, a.courseId, a.lessonId, a.attemptId, a.learnerUserId, a.rows.map((r) => r.questionNo), a.rows.map((r) => r.chosen), a.rows.map((r) => r.correct)]);
  }
  async insertWatch(tx: TxContext, w: { tenantId: string; enrollmentId: string; courseId: string; lessonId: string; learnerUserId: string; startedAt: Date; endedAt: Date; seconds: number; source: 'client_interval' | 'progress_delta' }): Promise<void> {
    await tx.query(
      `INSERT INTO watch_events (tenant_id, enrollment_id, course_id, lesson_id, learner_user_id, started_at, ended_at, seconds, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [w.tenantId, w.enrollmentId, w.courseId, w.lessonId, w.learnerUserId, w.startedAt, w.endedAt, w.seconds, w.source]);
  }

  /* ───────── studio reads ───────── */
  /** The courses the caller may read insights of: all of the tenant's (publisher) or the caller's own (instructor). µs keyset. */
  async courses(tenantId: string, ownerUserId: string | null, cursor: { ts: string; id: string } | undefined, limit: number): Promise<StudioCourseRow[]> {
    const p: unknown[] = [tenantId, limit + 1];
    let own = ''; let c = '';
    if (ownerUserId) { p.push(ownerUserId); own = `AND i.user_id = $${p.length}`; }
    if (cursor) { p.push(cursor.ts, cursor.id); c = `AND (c.created_at < $${p.length - 1}::timestamptz OR (c.created_at = $${p.length - 1}::timestamptz AND c.id < $${p.length}::uuid))`; }
    const r = await this.db(tenantId).query(
      `SELECT c.id, c.default_title, c.status, i.user_id AS iu, ${US_SQL('c.created_at')} AS us,
              (SELECT count(*)::int FROM enrollments e WHERE e.course_id = c.id AND e.tenant_id = $1 AND e.deleted_at IS NULL) AS enrolled,
              (SELECT count(*)::int FROM enrollments e WHERE e.course_id = c.id AND e.tenant_id = $1 AND e.deleted_at IS NULL AND e.completed_at IS NOT NULL) AS completed
         FROM courses c LEFT JOIN instructors i ON i.id = c.instructor_id
        WHERE c.tenant_id = $1 AND c.deleted_at IS NULL ${own} ${c}
        ORDER BY c.created_at DESC, c.id DESC LIMIT $2`, p);
    return r.rows.map((x: any) => ({ id: x.id, title: x.default_title, status: x.status, instructorUserId: x.iu ?? null, enrolled: Number(x.enrolled), completed: Number(x.completed), createdUs: x.us }));
  }
  async course(tenantId: string, courseId: string): Promise<StudioCourseRow | null> {
    const r = await this.db(tenantId).query(
      `SELECT c.id, c.default_title, c.status, i.user_id AS iu, ${US_SQL('c.created_at')} AS us,
              (SELECT count(*)::int FROM enrollments e WHERE e.course_id = c.id AND e.tenant_id = $1 AND e.deleted_at IS NULL) AS enrolled,
              (SELECT count(*)::int FROM enrollments e WHERE e.course_id = c.id AND e.tenant_id = $1 AND e.deleted_at IS NULL AND e.completed_at IS NOT NULL) AS completed
         FROM courses c LEFT JOIN instructors i ON i.id = c.instructor_id WHERE c.tenant_id = $1 AND c.id = $2 AND c.deleted_at IS NULL`, [tenantId, courseId]);
    const x = r.rows[0] as any;
    return x ? { id: x.id, title: x.default_title, status: x.status, instructorUserId: x.iu ?? null, enrolled: Number(x.enrolled), completed: Number(x.completed), createdUs: x.us } : null;
  }
  async funnel(tenantId: string, courseId: string): Promise<FunnelRow[]> {
    const r = await this.db(tenantId).query(
      `SELECT l.id, l.module_no, l.lesson_no, l.default_title, l.content_kind,
              count(lp.lesson_id)::int AS started, count(lp.completed_at)::int AS completed
         FROM course_lessons l
         LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.tenant_id = $1
        WHERE l.course_id = $2 AND l.deleted_at IS NULL AND (l.tenant_id = $1 OR l.tenant_id IS NULL)
        GROUP BY l.id, l.module_no, l.lesson_no, l.default_title, l.content_kind ORDER BY l.module_no, l.lesson_no`, [tenantId, courseId]);
    return r.rows.map((x: any) => ({ lessonId: x.id, moduleNo: Number(x.module_no), lessonNo: Number(x.lesson_no), title: x.default_title, kind: x.content_kind, started: Number(x.started), completed: Number(x.completed) }));
  }
  async answerLearners(tenantId: string, lessonIds: readonly string[]): Promise<Map<string, number>> {
    if (lessonIds.length === 0) return new Map();
    const r = await this.db(tenantId).query(`SELECT lesson_id, count(DISTINCT learner_user_id)::int AS n FROM quiz_answers WHERE tenant_id = $1 AND lesson_id = ANY($2::uuid[]) GROUP BY lesson_id`, [tenantId, [...lessonIds]]);
    return new Map(r.rows.map((x: any) => [x.lesson_id as string, Number(x.n)]));
  }
  async watchLearners(tenantId: string, lessonIds: readonly string[]): Promise<Map<string, number>> {
    if (lessonIds.length === 0) return new Map();
    const r = await this.db(tenantId).query(`SELECT lesson_id, count(DISTINCT learner_user_id)::int AS n FROM watch_events WHERE tenant_id = $1 AND lesson_id = ANY($2::uuid[]) GROUP BY lesson_id`, [tenantId, [...lessonIds]]);
    return new Map(r.rows.map((x: any) => [x.lesson_id as string, Number(x.n)]));
  }
  async questionMisses(tenantId: string, lessonId: string): Promise<Array<{ questionNo: number; total: number; missed: number }>> {
    const r = await this.db(tenantId).query(
      `SELECT question_no, count(*)::int AS total, count(*) FILTER (WHERE NOT correct)::int AS missed FROM quiz_answers WHERE tenant_id = $1 AND lesson_id = $2 GROUP BY question_no ORDER BY question_no`, [tenantId, lessonId]);
    return r.rows.map((x: any) => ({ questionNo: Number(x.question_no), total: Number(x.total), missed: Number(x.missed) }));
  }
  async secondsByHour(tenantId: string, lessonId: string): Promise<Array<{ hour: number; seconds: number }>> {
    const r = await this.db(tenantId).query(`SELECT ist_hour, sum(seconds)::bigint AS s FROM watch_events WHERE tenant_id = $1 AND lesson_id = $2 GROUP BY ist_hour ORDER BY ist_hour`, [tenantId, lessonId]);
    return r.rows.map((x: any) => ({ hour: Number(x.ist_hour), seconds: Number(x.s) }));
  }
  async captureBegan(tenantId: string): Promise<string | null> {
    const r = await this.db(tenantId).query(`SELECT began_at FROM capture_epochs WHERE capture = 'learner_quiz_watch'`);
    return r.rows[0]?.began_at ? new Date(r.rows[0].began_at).toISOString() : null;
  }
}
