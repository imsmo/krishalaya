// modules/education/services/learner-insights.service.ts · PC-56 TENANT-SW-f · W417 — /studio/insights. Who reads what: a publisher
// (`course.publish`) any course of the tenant; an instructor (`course.author`) their own courses only (instructors.user_id). Aggregates
// only — no learner is named ("instructors see shapes and shares, not individuals").
import { Injectable } from '@nestjs/common';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import type { LangMap } from '../../../core/i18n/lang-map';
import { AppError } from '../../../shared/errors/app-error';
import { decodeKeyset, encodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import { LearnerInsightsRepository } from '../repositories/learner-insights.repository';
import { LEARNER_FLOOR, LEARNER_METHODS, LEARNER_REFUSED, LEARNER_REFUSAL_SENTENCES, floorVerdict, missBps } from '../domain/learner-insights';

export interface StudioActor { userId: string; canPublish: boolean; canAuthor: boolean }
class StudioError extends AppError { constructor(code: string, message: string, status: number) { super(code, message, status, { code }); } }

@Injectable()
export class LearnerInsightsService {
  constructor(private readonly repo: LearnerInsightsRepository, private readonly ui: UiMessageRepository) {}

  private assert(a: StudioActor) { if (!a.canPublish && !a.canAuthor) throw new StudioError('FORBIDDEN', 'Learner insights need the studio (course.author) or the publishing desk (course.publish)', 403); }
  private async words(): Promise<{ methods: Record<string, LangMap>; refusals: Record<string, LangMap> }> {
    const m = await this.ui.mapsUnder('insights.method.').catch(() => new Map<string, LangMap>());
    const r = await this.ui.mapsUnder('insights.refusal.').catch(() => new Map<string, LangMap>());
    return {
      methods: Object.fromEntries(Object.entries(LEARNER_METHODS).map(([k, en]) => [k, m.get(`insights.method.${k}`) ?? { en }])),
      refusals: Object.fromEntries(Object.entries(LEARNER_REFUSAL_SENTENCES).map(([k, en]) => [k, r.get(`insights.refusal.${k}`) ?? { en }])),
    };
  }

  async courses(tenantId: string, a: StudioActor, q: { cursor?: string; limit?: number }) {
    this.assert(a);
    const limit = Math.min(Math.max(q.limit ?? 25, 1), 100);
    const rows = await this.repo.courses(tenantId, a.canPublish ? null : a.userId, decodeKeyset(q.cursor, UUID_RE), limit);
    const page = rows.slice(0, limit); const last = page[page.length - 1];
    return { items: page, nextCursor: rows.length > limit && last ? encodeKeyset(last.createdUs, last.id) : null, scope: a.canPublish ? 'tenant' : 'own' };
  }

  async course(tenantId: string, a: StudioActor, courseId: string, now = new Date()) {
    this.assert(a);
    const c = await this.repo.course(tenantId, courseId);
    if (!c || (!a.canPublish && c.instructorUserId !== a.userId)) throw new StudioError('COURSE_NOT_FOUND', 'Course not found', 404);   // 404, never "exists but not yours"
    const funnel = await this.repo.funnel(tenantId, courseId);
    const ids = funnel.map((f) => f.lessonId);
    const [answered, watched, began] = await Promise.all([this.repo.answerLearners(tenantId, ids), this.repo.watchLearners(tenantId, ids), this.repo.captureBegan(tenantId)]);
    const lessons: Array<Record<string, unknown>> = [];
    for (const f of funnel) {
      const qa = floorVerdict(answered.get(f.lessonId) ?? 0);
      const wa = floorVerdict(watched.get(f.lessonId) ?? 0);
      lessons.push({
        ...f,
        quizMiss: f.kind !== 'quiz' ? null : qa.kind === 'shown'
          ? { kind: 'shown' as const, learners: qa.learners, floor: qa.floor, questions: (await this.repo.questionMisses(tenantId, f.lessonId)).map((x) => ({ ...x, missBps: missBps(x.missed, x.total) })) }
          : qa,
        watchCurve: wa.kind === 'shown'
          ? { kind: 'shown' as const, learners: wa.learners, floor: wa.floor, hours: await this.repo.secondsByHour(tenantId, f.lessonId) }
          : wa,
      });
    }
    return {
      asOf: now.toISOString(), course: c, floor: LEARNER_FLOOR, captureBegan: began, lessons,
      advisory: { kind: 'refused', code: LEARNER_REFUSED.advisory }, ...(await this.words()),
    };
  }
}
