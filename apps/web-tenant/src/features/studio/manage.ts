// apps/web-tenant/src/features/studio/manage.ts · PURE helpers for the education studio (PC-26). Mirrors the
// API's course state machine (education/domain/course.state.ts: draft → review → published ; published ↔ paused ;
// any non-archived → archived) and the create/lesson DTO rules — the server re-checks permissions + transitions
// on every call (reflect, never grant). Money parsed float-free. No IO → unit-tested.
import { parseMajorToMinor } from '../listings/form';

import { parseQuizText } from './quiz';

export const COURSE_LEVELS = ['basic', 'intermediate', 'advanced'] as const;
export const CONTENT_KINDS = ['video', 'pdf', 'article', 'audio', 'quiz'] as const; // PC-26b: quiz authoring live

export function canSubmit(status: string | undefined | null): boolean { return status === 'draft'; }
export function canPublish(status: string | undefined | null): boolean { return status === 'review'; }
export function canPause(status: string | undefined | null): boolean { return status === 'published'; }
export function canResume(status: string | undefined | null): boolean { return status === 'paused'; }
export function canArchive(status: string | undefined | null): boolean { return !!status && status !== 'archived'; }
export function canEdit(status: string | undefined | null): boolean { return status === 'draft' || status === 'review'; }

export type CourseInput = { defaultTitle: string; level: string; priceMinor: string; certEnabled: boolean; coverMediaId?: string };
export type CourseResult = { ok: true; value: CourseInput } | { ok: false; error: 'title' | 'level' | 'price' };

export function buildCourse(raw: { title: string; level: string; priceMajor: string; certEnabled: boolean; coverMediaId?: string }): CourseResult {
  const defaultTitle = raw.title.trim();
  if (!defaultTitle || defaultTitle.length > 250) return { ok: false, error: 'title' };
  if (!(COURSE_LEVELS as readonly string[]).includes(raw.level)) return { ok: false, error: 'level' };
  const priceMinor = raw.priceMajor.trim() === '' ? '0' : parseMajorToMinor(raw.priceMajor);
  if (priceMinor === undefined) return { ok: false, error: 'price' };
  const value: CourseInput = { defaultTitle, level: raw.level, priceMinor, certEnabled: !!raw.certEnabled };
  if (raw.coverMediaId) value.coverMediaId = raw.coverMediaId;
  return { ok: true, value };
}

export type LessonResult =
  | { ok: true; value: { moduleNo: number; lessonNo: number; defaultTitle: string; contentKind: string; mediaId?: string; body?: string; quiz?: { questions: unknown[] } } }
  | { ok: false; error: 'lessonno' | 'title' | 'kind' | 'content' | 'quiz_empty' | 'quiz_question' | 'quiz_options' | 'quiz_answer' };

/** video/pdf/audio need an uploaded mediaId; article needs body text; quiz needs a parseable quiz (PC-26b).
 *  Never a hollow lesson. */
export function buildLesson(raw: { moduleNo: string; lessonNo: string; title: string; contentKind: string; mediaId: string; body: string; quizText?: string }): LessonResult {
  const moduleNo = Number.parseInt(raw.moduleNo || '1', 10);
  const lessonNo = Number.parseInt(raw.lessonNo, 10);
  if (!Number.isInteger(moduleNo) || moduleNo < 1 || moduleNo > 999) return { ok: false, error: 'lessonno' };
  if (!Number.isInteger(lessonNo) || lessonNo < 1 || lessonNo > 999) return { ok: false, error: 'lessonno' };
  const defaultTitle = raw.title.trim();
  if (!defaultTitle || defaultTitle.length > 250) return { ok: false, error: 'title' };
  if (!(CONTENT_KINDS as readonly string[]).includes(raw.contentKind)) return { ok: false, error: 'kind' };
  const mediaId = raw.mediaId.trim();
  const body = raw.body.trim();
  if (raw.contentKind === 'quiz') {
    const parsed = parseQuizText(raw.quizText ?? '');
    if (!parsed.ok) return { ok: false, error: `quiz_${parsed.error}` as 'quiz_empty' };
    return { ok: true, value: { moduleNo, lessonNo, defaultTitle, contentKind: 'quiz', quiz: parsed.value } };
  }
  if (raw.contentKind === 'article') {
    if (!body || body.length > 20000) return { ok: false, error: 'content' };
    return { ok: true, value: { moduleNo, lessonNo, defaultTitle, contentKind: raw.contentKind, body } };
  }
  if (!mediaId) return { ok: false, error: 'content' };
  const value: { moduleNo: number; lessonNo: number; defaultTitle: string; contentKind: string; mediaId: string; body?: string } =
    { moduleNo, lessonNo, defaultTitle, contentKind: raw.contentKind, mediaId };
  if (body) value.body = body;
  return { ok: true, value };
}
