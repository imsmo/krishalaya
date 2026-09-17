// apps/web-tenant/src/features/courses/lessons.ts · PURE helpers for the lesson record — PC-56 TENANT-7b.
//
// Three canon screens and three chains over one row: **W411** (the course builder — the OUTLINE and the reorder act),
// **W412** (the lesson video — chapters, thumbnail, the audio-only twin, subtitle tracks, *Mark ready*), **W413** (the
// quiz builder — options with a mandatory explanation each, the certificate threshold), **W2664–W2667** (the lesson
// FORM: *Add chapter · Edit · Save draft*, and the subtitle *Edit*), **W2668–W2670** (the lesson MUTATE: *Mark ready*,
// and W411's *move up/down*) and **W2727–W2730** (the quiz FORM: *Save question · Add explanations*). The API computes
// every verdict and every review; this file turns them into hrefs, keys and states, and holds the rulings the pages
// rely on:
//
//   • WHAT "PROCESSING" MEANS HERE. `core/media` stores a file and scans it; there is no transcoding, no audio
//     extraction, no frame extraction and no speech-to-text on this platform. W412's `queued · processing · ready`
//     is therefore printed as what it is — the SCAN state of the stored file and the lesson's own `ready` — and
//     *"Extract audio-only version"* is a second lesson the instructor uploads and pairs, never a switch.
//   • W412's *"Retry"* (on *"Couldn't process the video"*) is REFUSED BY NAME: there is no processing job to retry.
//     A failed or infected scan is answered by attaching a new upload through the form chain.
//   • W413's *"Record by voice"* is REFUSED BY NAME: no speech-to-text provider is wired to this console.
//   • NO ARITHMETIC THIS FILE INVENTS beyond integer counts: coverage is `met/of` from the API's gate, and the
//     per-lesson learner reality is NOTHING for a lesson nobody has opened.
import type { CourseGateCheck, LessonAct, LessonActVerdict, LessonMediaFacts, LessonStats, LessonView } from '@krishalaya/sdk-js';

/* --------------------------------------------------------------------------------------------------------- */
/* ROUTES                                                                                                    */
/* --------------------------------------------------------------------------------------------------------- */

export function outlineHref(courseId: string): string { return `/courses/${encodeURIComponent(courseId)}/outline`; }
export function lessonHref(courseId: string, lessonId: string): string { return `/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}`; }
export function lessonFormPath(courseId: string): string { return `/courses/${encodeURIComponent(courseId)}/lessons/new`; }
/** The lesson FORM chain: a new lesson, or `?lesson=` for an edit. */
export function newLessonHref(courseId: string, moduleNo?: number): string { return `${lessonFormPath(courseId)}${moduleNo ? `?moduleNo=${moduleNo}` : ''}`; }
export function editLessonHref(courseId: string, lessonId: string): string { return `${lessonFormPath(courseId)}?lesson=${encodeURIComponent(lessonId)}`; }
/** W412 "Subtitle tracks — Edit": the same chain in its second MODE, one language at a time. */
export function subtitleHref(courseId: string, lessonId: string, lang: string): string { return `${lessonFormPath(courseId)}?lesson=${encodeURIComponent(lessonId)}&mode=subtitle&languageCode=${encodeURIComponent(lang)}`; }
export function lessonActPath(courseId: string, lessonId: string): string { return `${lessonHref(courseId, lessonId)}/act`; }
/** The lesson MUTATE chain's confirm step — the reason travels in the URL until it is written. */
export function lessonActHref(courseId: string, lessonId: string, act: LessonAct): string { return `${lessonActPath(courseId, lessonId)}?step=confirm&act=${act}`; }
export function quizFormPath(courseId: string, lessonId: string): string { return `${lessonHref(courseId, lessonId)}/quiz`; }
/** W413 "Save question" / "New question": question `n` (1-based); `count + 1` is a new one. */
export function questionHref(courseId: string, lessonId: string, n: number): string { return `${quizFormPath(courseId, lessonId)}?n=${n}`; }

/* --------------------------------------------------------------------------------------------------------- */
/* THE CLOCK — display only; the API keeps seconds and parses what a person types                            */
/* --------------------------------------------------------------------------------------------------------- */

/** Seconds → the canon's `mm:ss` (`h:mm:ss` past an hour). Null for a lesson with no duration — W411 prints a dash. */
export function clockText(secs: number | null | undefined): string | null {
  if (secs === null || secs === undefined || secs < 0) return null;
  const n = Math.trunc(secs);
  const h = Math.floor(n / 3600); const m = Math.floor((n % 3600) / 60); const s = n % 60;
  const two = (x: number) => String(x).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

/* --------------------------------------------------------------------------------------------------------- */
/* W411 · THE OUTLINE                                                                                        */
/* --------------------------------------------------------------------------------------------------------- */

export const CONTENT_KINDS = ['video', 'pdf', 'article', 'quiz', 'live', 'audio'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];
export function kindKey(kind: string): string { return `lessons.kind.${kind}`; }
export function lessonStatusKey(status: string | undefined): string { return `lessons.status.${status ?? 'draft'}`; }
/** The lessons that carry speech, and so a subtitle track — the API's own set (`SPEECH_KINDS`). */
export const SPEECH_KINDS: ReadonlySet<string> = new Set(['video', 'audio', 'live']);

export type CoverageMark = 'reviewed' | 'draft' | 'missing' | 'not_applicable';
/** One language cell of W411's "Language coverage" column: `gu ✓`, `en —`, or n/a for a lesson with no speech. */
export function coverageMark(v: Pick<LessonView, 'lesson' | 'subtitles'>, lang: string): CoverageMark {
  if (!SPEECH_KINDS.has(v.lesson.contentKind)) return 'not_applicable';
  const s = v.subtitles[lang];
  return s === 'reviewed' ? 'reviewed' : s === 'draft' ? 'draft' : 'missing';
}
export function coverageKey(mark: CoverageMark): string { return `lessons.coverage.${mark}`; }

/** W411's footer — `12 lessons · 4 video ↔ 4 audio-only pairs · gu 12/12 · hi 12/12 · en 10/12` — in integer counts. */
export interface OutlineSummary { lessons: number; videos: number; paired: number; coverage: Array<{ lang: string; met: number; of: number }> }
export function outlineSummary(lessons: readonly LessonView[], languages: readonly string[]): OutlineSummary {
  const videos = lessons.filter((v) => v.lesson.contentKind === 'video');
  const speech = lessons.filter((v) => SPEECH_KINDS.has(v.lesson.contentKind));
  return {
    lessons: lessons.length,
    videos: videos.length,
    paired: videos.filter((v) => !!v.lesson.siblingLessonId).length,
    coverage: languages.map((lang) => ({ lang, met: speech.filter((v) => v.subtitles[lang] === 'reviewed').length, of: speech.length })),
  };
}

/** The per-lesson learner reality — NOTHING for a lesson nobody has opened (a `0` reads as a failure it is not). */
export function lessonCompletionText(s: LessonStats | null | undefined): string | null {
  if (!s || s.started <= 0) return null;
  return `${s.completed}/${s.started}`;
}

/** The lesson the outline row links to: W411 links video rows to W412 and the quiz row to W413 — every row has a record here. */
export function positionText(v: Pick<LessonView, 'lesson' | 'position'>): string { return `${v.lesson.moduleNo}·${v.position}`; }

/* --------------------------------------------------------------------------------------------------------- */
/* W412 · WHAT IS STORED, WHAT IS SERVED                                                                     */
/* --------------------------------------------------------------------------------------------------------- */

export type MediaState = 'none' | 'awaiting_scan' | 'clean' | 'blocked';
/**
 * W412's `queued · processing · ready`, honestly. The only pipeline this platform runs on a file is the antivirus
 * scan: `pending` is awaiting it, `clean` is servable through a presigned link, `infected`/`failed` is a file that will
 * never be served and needs a new upload. There is no transcoding step to be "processing" in.
 */
export function mediaState(m: LessonMediaFacts | null | undefined): MediaState {
  if (!m) return 'none';
  if (m.scanStatus === 'clean') return 'clean';
  if (m.scanStatus === 'pending') return 'awaiting_scan';
  return 'blocked';
}
export function mediaStateKey(s: MediaState): string { return `lessons.media.${s}`; }
/** A servable link is offered only for a CLEAN asset — the media boundary refuses anything else with a 409. */
export function canServe(m: LessonMediaFacts | null | undefined): boolean { return mediaState(m) === 'clean'; }
/** W412's "Re-upload video" / "Retry": a new upload through the FORM chain — never a retry of a job that does not exist. */
export function reuploadHref(courseId: string, lessonId: string): string { return editLessonHref(courseId, lessonId); }
export function retryIsMutation(): false { return false; }
export function retryRefusedKey(): string { return 'lessons.retry.refused'; }
/** The thumbnail is a declared second into the lesson's own video; nothing renders the frame. */
export function thumbnailKey(secs: number | null | undefined): string { return secs === null || secs === undefined ? 'lessons.thumbnail.none' : 'lessons.thumbnail.declared'; }
export function thumbnailRenderedIsClaimed(): false { return false; }
/** W413's "Record by voice": no speech-to-text is wired to this console. */
export function voiceRefusedKey(): string { return 'lessons.voice.refused'; }

/* --------------------------------------------------------------------------------------------------------- */
/* THE ACTS                                                                                                  */
/* --------------------------------------------------------------------------------------------------------- */

export function lessonActLabelKey(act: LessonAct): string { return `lessons.act.${act}`; }
export function lessonActDoneKey(act: LessonAct): string { return `lessons.actDone.${act}`; }
export function offeredLessonActs(acts: readonly LessonActVerdict[]): LessonActVerdict[] { return acts.filter((a) => a.allowed); }
export function refusedLessonActs(acts: readonly LessonActVerdict[]): LessonActVerdict[] { return acts.filter((a) => !a.allowed); }
export function lessonVerdictFor(acts: readonly LessonActVerdict[], act: LessonAct): LessonActVerdict | null { return acts.find((a) => a.act === act) ?? null; }
/** W412's header act is the state act; W411's row menu holds the two moves. */
export const HEADER_ACTS: readonly LessonAct[] = ['ready', 'reopen'] as const;
export const ROW_ACTS: readonly LessonAct[] = ['move_up', 'move_down'] as const;

/* --------------------------------------------------------------------------------------------------------- */
/* PAGE STATES                                                                                               */
/* --------------------------------------------------------------------------------------------------------- */

export type LessonPageState = 'notEnabled' | 'restricted' | 'notFound' | 'error' | 'readOnly';
export function lessonTransportState(code: string | null | undefined, status?: number): LessonPageState {
  if (code === 'FORBIDDEN' || code === 'EDUCATION_FORBIDDEN' || status === 403) return 'restricted';
  if (code === 'COURSE_NOT_FOUND' || code === 'LESSON_NOT_FOUND') return 'notFound';
  if (code === 'NOT_FOUND' || code === 'FEATURE_DISABLED' || status === 404) return 'notEnabled';
  return 'error';
}
export function lessonPageStateKey(s: LessonPageState): string { return `lessons.state.${s}`; }

/* --------------------------------------------------------------------------------------------------------- */
/* THE FORM CHAINS                                                                                           */
/* --------------------------------------------------------------------------------------------------------- */

export const LESSON_FORM = 'lesson';
export const SUBTITLE_FORM = 'subtitle';
export const QUESTION_FORM = 'question';
export const LESSON_FORM_FIELDS = ['moduleNo', 'defaultTitle', 'contentKind', 'mediaId', 'body', 'duration', 'siblingLessonId', 'thumbnailAt', 'chapters'] as const;
export const SUBTITLE_FORM_FIELDS = ['languageCode', 'body', 'reviewed'] as const;
export const QUIZ_MAX_OPTIONS = 6;
export const QUESTION_FORM_FIELDS = ['q', ...Array.from({ length: QUIZ_MAX_OPTIONS }, (_, i) => `opt${i + 1}`), ...Array.from({ length: QUIZ_MAX_OPTIONS }, (_, i) => `expl${i + 1}`), 'answer', 'passingPct'] as const;
/**
 * WHAT A LINK CAN CARRY. This console keeps a form's values in the query string (6d-4's ruling: bookmarkable steps, a
 * correct Back button, no client JS). A subtitle track or an article body is longer than the 1,500 characters the shared
 * chain allows, so these chains carry up to this many — the largest that stays under the 8 KiB request-line limit common
 * proxies enforce — and the textareas say so. A text longer than this cannot travel the chain and the form REFUSES it up
 * front (maxLength) instead of losing it silently; a server-side draft store for long texts is named, not built.
 */
export const MAX_CARRIED_LENGTH_LESSON = 7_000;
export const MAX_LONG_TEXT = 6_000;
export type LessonFormMode = 'lesson' | 'subtitle';
export function formMode(raw: string | null | undefined): LessonFormMode { return raw === 'subtitle' ? 'subtitle' : 'lesson'; }
/** Which mode's field list and form name. */
export function formOf(mode: LessonFormMode): { form: string; fields: readonly string[] } {
  return mode === 'subtitle' ? { form: SUBTITLE_FORM, fields: SUBTITLE_FORM_FIELDS } : { form: LESSON_FORM, fields: LESSON_FORM_FIELDS };
}
export function lessonFormDoneKey(mode: LessonFormMode, isEdit: boolean): string {
  if (mode === 'subtitle') return 'form.subtitle.saved';
  return isEdit ? 'form.lesson.updated' : 'form.lesson.created';
}
/** The question number a URL names: 1-based, small; anything else is the NEXT question (an append). */
export function questionNo(raw: string | null | undefined, count: number): number {
  const n = /^\d{1,3}$/.test(raw ?? '') ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= count + 1 ? n : count + 1;
}
/** The form's answer radio is the option NUMBER a person picks; the API turns it into the 0-based index. */
export function answerNumber(index: number | null | undefined): string { return index === null || index === undefined ? '' : String(index + 1); }
/** W416's gate row label: one per language for `SUBTITLES` (7b), the code alone otherwise. */
export function gateRowKey(c: Pick<CourseGateCheck, 'code' | 'lang'>): string { return c.code === 'SUBTITLES' ? `${c.code}:${c.lang ?? ''}` : c.code; }
