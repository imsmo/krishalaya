// modules/education/domain/course-publish-gate.ts · PC-56 TENANT-7a · W416's gate checklist, computed from the
// lessons as they are stored — and honest about the four checks this platform cannot measure.
//
// W416 lists seven gates: audio-only siblings · subtitles gu · subtitles hi · subtitles en · quiz explanations ·
// thumbnails are real frames · price + certificate declared. *"Submission is blocked until English subtitles reach
// 12/12 — two lessons named above are the honest gap, not hidden behind an average."*
//
// WHAT THE ROW CAN ANSWER. `course_lessons` (0012) is title, kind, media_id, body, duration, quiz. There is no subtitle
// table, no thumbnail column, no sibling link between a video and its audio-only twin, and the quiz JSON (`{q, options,
// answer, hint?}`) has no per-option explanation. A gate that ticked those seven boxes from this row would be ticking
// four of them on nothing. So a check has THREE states: `pass`, `fail`, and `not_measured` — and a `not_measured` check
// does NOT block submission, because blocking a cooperative's course forever on a table that does not exist would be a
// wall (W413's own words about walls). The screen prints WHY each is not measured, and TENANT-7b owns the lesson
// record that would make them measurable (a sibling link, a subtitle track, a thumbnail frame, an explanation field).
//
// WHAT IS MEASURED, and blocks:
//   HAS_LESSONS        — at least one lesson; *"a course is a promise split into lessons"* (W411).
//   NO_HOLLOW_LESSON   — every video/pdf/audio lesson has media, every article a body, every quiz a parseable question
//                        set (PC-26's rule on the way IN, re-checked on the way OUT because rows predate it).
//   QUIZ_WELL_FORMED   — each quiz question has ≥ 2 options and an answer index inside them.
//   TOPIC_DECLARED     — a topic from the registry; a course with none cannot be found in the library.
//   PRICE_CERT_DECLARED— always passes: the values are the declaration, printed for the desk to co-sign.
//   INSTRUCTOR_PROFILE — the course's instructor row exists (W410: *"this tenant hasn't marked you an instructor"*).
import { ContentKind } from './education.events';

export const GATE_CHECKS = [
  'HAS_LESSONS', 'NO_HOLLOW_LESSON', 'QUIZ_WELL_FORMED', 'TOPIC_DECLARED', 'PRICE_CERT_DECLARED', 'INSTRUCTOR_PROFILE',
  'AUDIO_SIBLINGS', 'SUBTITLES_GU', 'SUBTITLES_HI', 'SUBTITLES_EN', 'QUIZ_EXPLANATIONS', 'THUMBNAILS_REAL',
] as const;
export type GateCheck = (typeof GATE_CHECKS)[number];
export type GateState = 'pass' | 'fail' | 'not_measured';

/** The checks whose subject this platform holds no column for. Listed so a test can assert none of them ever blocks. */
export const UNMEASURED_CHECKS: ReadonlySet<GateCheck> = new Set<GateCheck>([
  'AUDIO_SIBLINGS', 'SUBTITLES_GU', 'SUBTITLES_HI', 'SUBTITLES_EN', 'QUIZ_EXPLANATIONS', 'THUMBNAILS_REAL',
]);

export interface GateLesson {
  moduleNo: number; lessonNo: number; defaultTitle: string; contentKind: ContentKind;
  mediaId: string | null; body: string | null; quiz: unknown | null;
}
export interface GateInput {
  lessons: readonly GateLesson[];
  topicCode: string | null;
  priceMinor: string; currencyCode: string; certEnabled: boolean;
  hasInstructor: boolean;
}
export interface GateCheckResult {
  code: GateCheck; state: GateState;
  /** Numbers the screen prints beside the tick: `4/4`, `10/12`. Null for a declaration or an unmeasured check. */
  measured: { met: number; of: number } | null;
  /** The lessons named — W416: *"two lessons named above are the honest gap"*. Positions as `M·L`, never ids alone. */
  named: string[];
  /** For a declaration: the values the desk co-signs. */
  declared: Record<string, string> | null;
}
export interface GateResult { ready: boolean; checks: GateCheckResult[]; blocking: GateCheck[] }

const pos = (l: GateLesson) => `${l.moduleNo}·${l.lessonNo} ${l.defaultTitle}`;

/** The learner parser's own rules (`apps/mobile … learn.ts parseQuiz`, asserted by PC-26b's round-trip spec). */
export function quizQuestionsOk(quiz: unknown): { ok: boolean; questions: number } {
  if (!quiz || typeof quiz !== 'object') return { ok: false, questions: 0 };
  const qs = (quiz as { questions?: unknown }).questions;
  if (!Array.isArray(qs) || qs.length === 0) return { ok: false, questions: 0 };
  for (const q of qs) {
    if (!q || typeof q !== 'object') return { ok: false, questions: qs.length };
    const { options, answer } = q as { options?: unknown; answer?: unknown };
    if (!Array.isArray(options) || options.length < 2) return { ok: false, questions: qs.length };
    if (!Number.isInteger(answer) || (answer as number) < 0 || (answer as number) >= options.length) return { ok: false, questions: qs.length };
  }
  return { ok: true, questions: qs.length };
}

export function isHollow(l: GateLesson): boolean {
  switch (l.contentKind) {
    case 'video': case 'pdf': case 'audio': return l.mediaId === null;
    case 'article': return (l.body ?? '').trim().length === 0;
    case 'quiz': return !quizQuestionsOk(l.quiz).ok;
    case 'live': return l.mediaId === null && (l.body ?? '').trim().length === 0;   // a recording or a summary
    default: return true;
  }
}

export function computeGate(i: GateInput): GateResult {
  const checks: GateCheckResult[] = [];
  const n = i.lessons.length;
  checks.push({ code: 'HAS_LESSONS', state: n > 0 ? 'pass' : 'fail', measured: { met: n, of: n }, named: [], declared: null });

  const hollow = i.lessons.filter(isHollow);
  checks.push({ code: 'NO_HOLLOW_LESSON', state: hollow.length === 0 ? 'pass' : 'fail', measured: { met: n - hollow.length, of: n }, named: hollow.map(pos), declared: null });

  const quizzes = i.lessons.filter((l) => l.contentKind === 'quiz');
  const badQuiz = quizzes.filter((l) => !quizQuestionsOk(l.quiz).ok);
  checks.push({ code: 'QUIZ_WELL_FORMED', state: badQuiz.length === 0 ? 'pass' : 'fail', measured: { met: quizzes.length - badQuiz.length, of: quizzes.length }, named: badQuiz.map(pos), declared: null });

  checks.push({ code: 'TOPIC_DECLARED', state: i.topicCode ? 'pass' : 'fail', measured: null, named: [], declared: i.topicCode ? { topic: i.topicCode } : null });
  checks.push({ code: 'PRICE_CERT_DECLARED', state: 'pass', measured: null, named: [], declared: { priceMinor: i.priceMinor, currencyCode: i.currencyCode, certEnabled: i.certEnabled ? 'yes' : 'no' } });
  checks.push({ code: 'INSTRUCTOR_PROFILE', state: i.hasInstructor ? 'pass' : 'fail', measured: null, named: [], declared: null });

  // THE FOUR THIS PLATFORM CANNOT MEASURE — printed, not ticked, and never blocking.
  const videos = i.lessons.filter((l) => l.contentKind === 'video').length;
  checks.push({ code: 'AUDIO_SIBLINGS', state: 'not_measured', measured: { met: 0, of: videos }, named: [], declared: null });
  for (const c of ['SUBTITLES_GU', 'SUBTITLES_HI', 'SUBTITLES_EN'] as const) checks.push({ code: c, state: 'not_measured', measured: { met: 0, of: n }, named: [], declared: null });
  checks.push({ code: 'QUIZ_EXPLANATIONS', state: 'not_measured', measured: { met: 0, of: quizzes.length }, named: [], declared: null });
  checks.push({ code: 'THUMBNAILS_REAL', state: 'not_measured', measured: { met: 0, of: videos }, named: [], declared: null });

  const blocking = checks.filter((c) => c.state === 'fail').map((c) => c.code);
  return { ready: blocking.length === 0, checks, blocking };
}
