// apps/web-tenant/src/features/studio/manage.ts · PURE helpers for the education studio (PC-26) — the LESSON rules.
// The server re-checks everything on every call (reflect, never grant). No IO → unit-tested.
import { parseQuizText } from './quiz';

export const CONTENT_KINDS = ['video', 'pdf', 'article', 'audio', 'quiz'] as const; // PC-26b: quiz authoring live

// PC-56 TENANT-7a: `canSubmit/canPublish/canPause/canResume/canArchive/canEdit` and `buildCourse` are GONE. The course's
// acts are the API's verdicts (`courses.acts`) and the course form is the API-reviewed chain at `/courses/new`; a
// console-side mirror of either would agree with the server exactly once.

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
