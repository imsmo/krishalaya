// apps/mobile/src/features/education/learn.ts · PURE learning logic for P-16 (training/quiz). No React/native
// (SDK types are `import type` → erased) → unit-tested. The SERVER is the authority on enrollment progress + the
// quiz score it stores (the client posts the score it computed; the server recomputes overall % + completion).
// These helpers parse the opaque lesson `quiz` payload defensively and compute a UX score/progress.
import type { CourseLesson, LessonProgress, Enrollment } from '@krishalaya/sdk-js';

export interface QuizQuestion { q: string; options: string[]; answer: number; hint?: string }
export const QUIZ_PASS_PCT = 60;

/** Parse the opaque lesson.quiz JSON into a normalized question list, or null if it isn't a usable quiz. Accepts
 * `{ questions: [{ q|question|text, options|choices: string[], answer|correct|correctIndex: number, hint?: string }] }`.
 * Tolerant of shape drift (authoring is loosely typed server-side) — anything malformed yields null rather than
 * throwing. `hint` is optional: it is carried through only when the author supplied a non-empty string; the screen
 * renders no hint block when absent (§13 — never a fabricated hint). */
export function parseQuiz(raw: unknown): QuizQuestion[] | null {
  const arr = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' && Array.isArray((raw as any).questions) ? (raw as any).questions : null);
  if (!arr || arr.length === 0) return null;
  const out: QuizQuestion[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') return null;
    const q = (item as any).q ?? (item as any).question ?? (item as any).text;
    const options = (item as any).options ?? (item as any).choices;
    const answer = (item as any).answer ?? (item as any).correct ?? (item as any).correctIndex;
    const hintRaw = (item as any).hint ?? (item as any).explanation;
    if (typeof q !== 'string' || !Array.isArray(options) || options.length < 2 || !options.every((o) => typeof o === 'string')) return null;
    if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0 || answer >= options.length) return null;
    const question: QuizQuestion = { q, options, answer };
    if (typeof hintRaw === 'string' && hintRaw.trim().length > 0) question.hint = hintRaw;
    out.push(question);
  }
  return out;
}

/** Minimum number of correct answers needed to pass a quiz of `total` questions — derived from QUIZ_PASS_PCT with
 * integer math (ceil), NOT a hardcoded "4/5". Drives the "Pass: N/total correct" header. Pure. */
export function passThreshold(total: number): number {
  if (total <= 0) return 0;
  return Math.ceil((QUIZ_PASS_PCT * total) / 100);
}

export interface QuizResult { correct: number; total: number; scorePct: number; passed: boolean }
/** Score answers (index per question; -1/undefined = unanswered) against the parsed quiz. Pass ≥ QUIZ_PASS_PCT.
 * scorePct is an integer 0–100 (computed with integer math — no float surprises). */
export function scoreQuiz(questions: QuizQuestion[], answers: ReadonlyArray<number | null | undefined>): QuizResult {
  const total = questions.length;
  if (total === 0) return { correct: 0, total: 0, scorePct: 0, passed: false };
  let correct = 0;
  for (let i = 0; i < total; i++) if (answers[i] === questions[i].answer) correct += 1;
  const scorePct = Math.round((correct * 100) / total);
  return { correct, total, scorePct, passed: scorePct >= QUIZ_PASS_PCT };
}

/** Whether a lesson is completed in this enrollment's progress set. */
export function lessonCompleted(progress: LessonProgress[], lessonId: string): boolean {
  return (progress ?? []).some((p) => p.lessonId === lessonId && !!p.completedAt);
}

/** Course progress as an integer 0–100 = completed lessons / total lessons (client estimate for display; the
 * server's enrollment.progressPct is authoritative). */
export function courseProgressPct(lessons: Pick<CourseLesson, 'id'>[], progress: LessonProgress[]): number {
  const total = (lessons ?? []).length;
  if (total === 0) return 0;
  const done = (lessons ?? []).filter((l) => lessonCompleted(progress, l.id)).length;
  return Math.round((done * 100) / total);
}

/** Whether the course is complete per the server (the authority). */
export function isCourseComplete(enrollment: Pick<Enrollment, 'completedAt'> | null): boolean {
  return !!enrollment && !!enrollment.completedAt;
}

/** The next not-yet-completed lesson id (drives a "Continue" CTA), or null when all done / no lessons. */
export function nextLessonId(lessons: Pick<CourseLesson, 'id'>[], progress: LessonProgress[]): string | null {
  for (const l of lessons ?? []) if (!lessonCompleted(progress, l.id)) return l.id;
  return null;
}
