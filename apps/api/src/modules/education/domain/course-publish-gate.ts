// modules/education/domain/course-publish-gate.ts · PC-56 TENANT-7a · W416's gate checklist, computed from the
// lessons as they are stored. PC-56 TENANT-7b: every check is MEASURED now.
//
// W416 lists seven gates: audio-only siblings · subtitles gu · subtitles hi · subtitles en · quiz explanations ·
// thumbnails are real frames · price + certificate declared. *"Submission is blocked until English subtitles reach
// 12/12 — two lessons named above are the honest gap, not hidden behind an average."*
//
// WHAT CHANGED BETWEEN 7a AND 7b. `course_lessons` (0012) was title, kind, media_id, body, duration, quiz; six of the
// canon's checks had no column and 7a printed them `not_measured` — never blocking, with WHY, owned by name by 7b. 0171
// added the columns (a sibling link, a thumbnail frame, a subtitle table, per-option explanations in the quiz JSON, a
// passing threshold, a lesson `ready` state). A refusal left standing after the thing was built is the same defect as a
// claim that stopped being true (TENANT-6d-2's rule), so the six are measured here and BLOCK — the canon's own words:
// *"the rule is the default, not a preference"*. The `not_measured` state stays in the type for a check some future wave
// cannot yet answer; no check in this file uses it today.
//
// THE LANGUAGES ARE THE TENANT'S, NOT THREE CODES. 7a had `SUBTITLES_GU / _HI / _EN` as three fixed checks — Rule Zero
// says a check that names three languages blocks the fourth. There is ONE check, `SUBTITLES`, emitted once per language
// the tenant teaches in (`tenant_languages`; the platform's active languages when the tenant has declared none —
// nothing writes `tenant_languages` today, grep in the 7b report), each carrying its `lang`.
//
// WHAT IS MEASURED, and blocks:
//   HAS_LESSONS         — at least one lesson; *"a course is a promise split into lessons"* (W411).
//   NO_HOLLOW_LESSON    — every video/pdf/audio lesson has media, every article a body, every quiz a parseable set.
//   QUIZ_WELL_FORMED    — each quiz question has ≥ 2 options and an answer index inside them.
//   LESSONS_READY       — every lesson is `ready` (W412 *"Mark ready"*, the instructor's per-lesson attestation).
//   AUDIO_SIBLINGS      — every video lesson names its audio-only twin (W411's rule; the 2G fallback).
//   SUBTITLES (× lang)  — every lesson that carries speech (video/audio/live) has a REVIEWED track in that language
//                         (W412: *"nothing publishes until a human reviews it"*).
//   QUIZ_EXPLANATIONS   — every option of every quiz question carries an explanation (W413).
//   QUIZ_THRESHOLD      — every quiz declares its certificate threshold (W413).
//   THUMBNAILS_REAL     — every video lesson declares its thumbnail as a second into its OWN video (W412); the frame is
//                         a declaration the row holds and nothing renders (core/media has no codec) — the check
//                         measures that the declaration exists and falls inside the lesson.
//   TOPIC_DECLARED      — a topic from the registry; a course with none cannot be found in the library.
//   PRICE_CERT_DECLARED — always passes: the values are the declaration, printed for the desk to co-sign.
//   INSTRUCTOR_PROFILE  — the course's instructor row exists (W410: *"this tenant hasn't marked you an instructor"*).
import { ContentKind } from './education.events';
import { SPEECH_KINDS } from './lesson-review';
import { missingExplanations, quizWellFormed, readQuiz } from './quiz';

export const GATE_CHECKS = [
  'HAS_LESSONS', 'NO_HOLLOW_LESSON', 'QUIZ_WELL_FORMED', 'LESSONS_READY', 'TOPIC_DECLARED', 'PRICE_CERT_DECLARED', 'INSTRUCTOR_PROFILE',
  'AUDIO_SIBLINGS', 'SUBTITLES', 'QUIZ_EXPLANATIONS', 'QUIZ_THRESHOLD', 'THUMBNAILS_REAL',
] as const;
export type GateCheck = (typeof GATE_CHECKS)[number];
export type GateState = 'pass' | 'fail' | 'not_measured';

export interface GateLesson {
  id: string; moduleNo: number; lessonNo: number; defaultTitle: string; contentKind: ContentKind;
  mediaId: string | null; body: string | null; quiz: unknown | null;
  status: string; siblingLessonId: string | null; thumbnailFrameSecs: number | null; durationSecs: number | null; quizPassingPct: number | null;
}
export interface GateInput {
  lessons: readonly GateLesson[];
  /** lesson id → language codes with a REVIEWED subtitle track. */
  reviewedSubtitles: ReadonlyMap<string, ReadonlySet<string>>;
  /** The languages the tenant teaches in. */
  languages: readonly string[];
  topicCode: string | null;
  priceMinor: string; currencyCode: string; certEnabled: boolean;
  hasInstructor: boolean;
}
export interface GateCheckResult {
  code: GateCheck; state: GateState;
  /** Set on the per-language check only. */
  lang: string | null;
  /** Numbers the screen prints beside the tick: `4/4`, `10/12`. Null for a declaration. */
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
  const doc = readQuiz(quiz);
  return { ok: quizWellFormed(doc), questions: doc?.questions.length ?? 0 };
}

export function isHollow(l: Pick<GateLesson, 'contentKind' | 'mediaId' | 'body' | 'quiz'>): boolean {
  switch (l.contentKind) {
    case 'video': case 'pdf': case 'audio': return l.mediaId === null;
    case 'article': return (l.body ?? '').trim().length === 0;
    case 'quiz': return !quizQuestionsOk(l.quiz).ok;
    case 'live': return l.mediaId === null && (l.body ?? '').trim().length === 0;   // a recording or a summary
    default: return true;
  }
}

/** Does this video's thumbnail declaration exist and fall inside the lesson? */
export function thumbnailDeclared(l: Pick<GateLesson, 'thumbnailFrameSecs' | 'durationSecs'>): boolean {
  if (l.thumbnailFrameSecs === null) return false;
  return l.durationSecs === null || l.thumbnailFrameSecs < l.durationSecs;
}

function measured(code: GateCheck, all: readonly GateLesson[], failing: readonly GateLesson[], lang: string | null = null): GateCheckResult {
  return { code, lang, state: failing.length === 0 ? 'pass' : 'fail', measured: { met: all.length - failing.length, of: all.length }, named: failing.map(pos), declared: null };
}

export function computeGate(i: GateInput): GateResult {
  const checks: GateCheckResult[] = [];
  const n = i.lessons.length;
  checks.push({ code: 'HAS_LESSONS', lang: null, state: n > 0 ? 'pass' : 'fail', measured: { met: n, of: n }, named: [], declared: null });
  checks.push(measured('NO_HOLLOW_LESSON', i.lessons, i.lessons.filter(isHollow)));

  const quizzes = i.lessons.filter((l) => l.contentKind === 'quiz');
  checks.push(measured('QUIZ_WELL_FORMED', quizzes, quizzes.filter((l) => !quizQuestionsOk(l.quiz).ok)));
  checks.push(measured('LESSONS_READY', i.lessons, i.lessons.filter((l) => l.status !== 'ready')));

  checks.push({ code: 'TOPIC_DECLARED', lang: null, state: i.topicCode ? 'pass' : 'fail', measured: null, named: [], declared: i.topicCode ? { topic: i.topicCode } : null });
  checks.push({ code: 'PRICE_CERT_DECLARED', lang: null, state: 'pass', measured: null, named: [], declared: { priceMinor: i.priceMinor, currencyCode: i.currencyCode, certEnabled: i.certEnabled ? 'yes' : 'no' } });
  checks.push({ code: 'INSTRUCTOR_PROFILE', lang: null, state: i.hasInstructor ? 'pass' : 'fail', measured: null, named: [], declared: null });

  // THE SIX 7a COULD NOT MEASURE — measured on 0171's columns.
  const videos = i.lessons.filter((l) => l.contentKind === 'video');
  checks.push(measured('AUDIO_SIBLINGS', videos, videos.filter((l) => l.siblingLessonId === null)));
  const speech = i.lessons.filter((l) => SPEECH_KINDS.has(l.contentKind));
  for (const lang of i.languages) {
    checks.push(measured('SUBTITLES', speech, speech.filter((l) => !(i.reviewedSubtitles.get(l.id)?.has(lang) ?? false)), lang));
  }
  checks.push(measured('QUIZ_EXPLANATIONS', quizzes, quizzes.filter((l) => missingExplanations(readQuiz(l.quiz)).length > 0 || readQuiz(l.quiz) === null)));
  checks.push(measured('QUIZ_THRESHOLD', quizzes, quizzes.filter((l) => l.quizPassingPct === null)));
  checks.push(measured('THUMBNAILS_REAL', videos, videos.filter((l) => !thumbnailDeclared(l))));

  const blocking = [...new Set(checks.filter((c) => c.state === 'fail').map((c) => c.code))];
  return { ready: blocking.length === 0, checks, blocking };
}
