// modules/education/domain/lesson-review.ts · PC-56 TENANT-7b · the lesson form's review step — W2665 (review), W2664
// (form-error) — computed from the facts the writer uses, never an echo of what was typed (7a's rule, 6d-4's shape).
//
// The canon's lesson module names three actions on this chain: *"Add chapter · Edit · Save draft"*. All three are ONE
// form over ONE row — the lesson record as 0171 holds it — because a chapter is a line on the lesson, an edit is the
// lesson, and *Save draft* is what the write does (a lesson is born `draft`; `ready` is an act). W412's subtitle
// *"Edit"* buttons land on the same chain in a second MODE (`reviewSubtitle`): one track, one language, one row.
//
// WHAT THE REVIEW SHOWS THAT THE FORM NEVER ASKED: the POSITION the lesson will take (`1·5` — appended to its module;
// moving it is the reorder act), the media asset's KIND and SCAN STATE (so *"processing"* is the scan and nothing
// else), the duration and every clock in the canon's `mm:ss`, and the audio twin by its own title.
import { ReviewDiffRow, ReviewField, ReviewRefusal, ReviewResult, WRITER_REFUSALS, WriterIssue, field, reviewResult, trimOrNull, writerRefusals } from '../../../shared/form-review';
import { CONTENT_KINDS, ContentKind } from './education.events';
import { LessonChapter } from './course-lesson.entity';
import { ChapterProblem, chaptersToText, formatClock, parseChapters, parseClock } from './lesson-clock';

export const LESSON_REVIEW_REFUSALS = [
  'NO_AUTHOR', 'NOT_OWNER', 'COURSE_NOT_FOUND', 'COURSE_ARCHIVED', 'LESSON_NOT_FOUND', 'LESSON_READY',
  'TITLE_REQUIRED', 'KIND_INVALID', 'MODULE_INVALID',
  'MEDIA_REQUIRED', 'MEDIA_UNKNOWN', 'MEDIA_KIND_MISMATCH', 'MEDIA_NOT_FOR_KIND',
  'BODY_REQUIRED', 'DURATION_REQUIRED', 'DURATION_INVALID',
  'SIBLING_NOT_FOR_KIND', 'SIBLING_UNKNOWN', 'SIBLING_NOT_AUDIO', 'SIBLING_TAKEN', 'SIBLING_IS_SELF',
  'THUMBNAIL_NOT_FOR_KIND', 'THUMBNAIL_INVALID', 'THUMBNAIL_BEYOND_DURATION',
  'CHAPTERS_NOT_FOR_KIND', 'CHAPTER_LINE_INVALID', 'CHAPTER_ORDER', 'CHAPTER_BEYOND_DURATION', 'CHAPTER_TITLE_LONG',
  ...WRITER_REFUSALS,
] as const;
export type LessonReviewRefusal = (typeof LESSON_REVIEW_REFUSALS)[number];

/** Every field the chain carries — one list, shared by the reviewer, the DTO and the console's form. */
export const LESSON_FORM_FIELDS = ['moduleNo', 'defaultTitle', 'contentKind', 'mediaId', 'body', 'duration', 'siblingLessonId', 'thumbnailAt', 'chapters'] as const;
export type LessonFormField = (typeof LESSON_FORM_FIELDS)[number];

/** Which media kind each content kind carries — and which carry none. `live` may carry its recording, video or audio. */
export const MEDIA_KIND_FOR: Readonly<Record<ContentKind, readonly string[]>> = Object.freeze({
  video: ['video'], audio: ['audio'], pdf: ['document'], live: ['video', 'audio'], article: [], quiz: [],
});
export const MEDIA_REQUIRED_FOR: ReadonlySet<ContentKind> = new Set<ContentKind>(['video', 'audio', 'pdf']);
export const DURATION_REQUIRED_FOR: ReadonlySet<ContentKind> = new Set<ContentKind>(['video', 'audio']);
/** Chapters mark time; only a lesson with time has them. */
export const TIMED_KINDS: ReadonlySet<ContentKind> = new Set<ContentKind>(['video', 'audio', 'live']);
/** A lesson that carries speech, and so a subtitle track. */
export const SPEECH_KINDS: ReadonlySet<ContentKind> = new Set<ContentKind>(['video', 'audio', 'live']);

export interface CurrentLesson {
  id: string; status: string; moduleNo: number; lessonNo: number;
  defaultTitle: string; contentKind: ContentKind; mediaId: string | null; body: string | null; durationSecs: number | null;
  siblingLessonId: string | null; thumbnailFrameSecs: number | null; chapters: LessonChapter[];
}
export interface MediaFacts { id: string; kind: string; scanStatus: string; mimeType: string; bytes: string; durationSecs: number | null }
export interface SiblingFacts { id: string; contentKind: ContentKind; defaultTitle: string; /** the video already paired with it, if any */ pairedWith: string | null }

export interface LessonReviewInput {
  canAuthor: boolean; canPublish: boolean;
  /** The caller is the user behind the course's instructor row. */
  isOwner: boolean;
  /** The course: undefined never happens; null = no such course of ours. */
  course: { status: string } | null;
  /** Edit mode: the row as it stands (undefined = create; null = an id was named and no such lesson is ours). */
  current?: CurrentLesson | null;
  /** On a create: the number the lesson will take in the module it names. */
  nextLessonNo: number;
  entered: Partial<Record<LessonFormField, string | null | undefined>>;
  /** Lookup of `mediaId` in THIS tenant's bucket: undefined = nothing typed; null = typed and no such asset. */
  media: MediaFacts | null | undefined;
  /** Lookup of `siblingLessonId` among THIS course's lessons: undefined = nothing typed; null = typed and not ours. */
  sibling: SiblingFacts | null | undefined;
  writerIssues?: readonly WriterIssue[];
}

export interface LessonStored {
  moduleNo: number; lessonNo: number; defaultTitle: string; contentKind: ContentKind; mediaId: string | null; body: string | null;
  durationSecs: number | null; siblingLessonId: string | null; thumbnailFrameSecs: number | null; chapters: LessonChapter[];
}

const isKind = (s: string): s is ContentKind => (CONTENT_KINDS as readonly string[]).includes(s);

export function reviewLesson(i: LessonReviewInput): ReviewResult {
  const refusals: ReviewRefusal[] = [];
  const isEdit = i.current !== undefined;
  if (!i.canAuthor && !i.canPublish) refusals.push({ field: null, code: 'NO_AUTHOR' });
  if (!i.course) refusals.push({ field: null, code: 'COURSE_NOT_FOUND' });
  else {
    if (!i.isOwner && !i.canPublish) refusals.push({ field: null, code: 'NOT_OWNER' });
    if (i.course.status === 'archived') refusals.push({ field: null, code: 'COURSE_ARCHIVED' });
  }
  if (isEdit) {
    if (!i.current) refusals.push({ field: null, code: 'LESSON_NOT_FOUND' });
    else if (i.current.status === 'ready') refusals.push({ field: null, code: 'LESSON_READY' });
  }

  const title = trimOrNull(i.entered.defaultTitle);
  if (title === null) refusals.push({ field: 'defaultTitle', code: 'TITLE_REQUIRED' });

  const kindTyped = trimOrNull(i.entered.contentKind);
  const kind: ContentKind | null = kindTyped !== null && isKind(kindTyped) ? kindTyped : null;
  if (kind === null) refusals.push({ field: 'contentKind', code: 'KIND_INVALID' });

  // POSITION: the module a person names (default 1) and the number the platform gives — an edit keeps both.
  const moduleTyped = trimOrNull(i.entered.moduleNo);
  let moduleNo: number | null = isEdit ? (i.current?.moduleNo ?? null) : 1;
  if (!isEdit && moduleTyped !== null) { moduleNo = /^\d{1,3}$/.test(moduleTyped) && Number(moduleTyped) >= 1 ? Number(moduleTyped) : null; if (moduleNo === null) refusals.push({ field: 'moduleNo', code: 'MODULE_INVALID' }); }
  const lessonNo = isEdit ? (i.current?.lessonNo ?? null) : i.nextLessonNo;

  // MEDIA: required for video/pdf/audio, forbidden for article/quiz, of the kind the lesson is.
  const mediaTyped = trimOrNull(i.entered.mediaId);
  let mediaStored: string | null = null;
  if (mediaTyped !== null) {
    if (!i.media) refusals.push({ field: 'mediaId', code: 'MEDIA_UNKNOWN' });
    else if (kind !== null && MEDIA_KIND_FOR[kind].length === 0) refusals.push({ field: 'mediaId', code: 'MEDIA_NOT_FOR_KIND' });
    else if (kind !== null && !MEDIA_KIND_FOR[kind].includes(i.media.kind)) refusals.push({ field: 'mediaId', code: 'MEDIA_KIND_MISMATCH' });
    else mediaStored = `${i.media.id} · ${i.media.kind} · ${i.media.scanStatus}`;
  } else if (kind !== null && MEDIA_REQUIRED_FOR.has(kind)) refusals.push({ field: 'mediaId', code: 'MEDIA_REQUIRED' });

  const body = trimOrNull(i.entered.body);
  if (kind === 'article' && body === null) refusals.push({ field: 'body', code: 'BODY_REQUIRED' });

  // DURATION: `8:20` → `08:20`; required where the canon prints one.
  const durTyped = trimOrNull(i.entered.duration);
  let durationSecs: number | null = null;
  if (durTyped !== null) { durationSecs = parseClock(durTyped); if (durationSecs === null) refusals.push({ field: 'duration', code: 'DURATION_INVALID' }); }
  else if (kind !== null && DURATION_REQUIRED_FOR.has(kind)) refusals.push({ field: 'duration', code: 'DURATION_REQUIRED' });

  // THE AUDIO TWIN: a video's, an audio lesson's of this course, not already another video's.
  const sibTyped = trimOrNull(i.entered.siblingLessonId);
  let siblingStored: string | null = null;
  if (sibTyped !== null) {
    if (kind !== null && kind !== 'video') refusals.push({ field: 'siblingLessonId', code: 'SIBLING_NOT_FOR_KIND' });
    else if (i.current && sibTyped === i.current.id) refusals.push({ field: 'siblingLessonId', code: 'SIBLING_IS_SELF' });
    else if (!i.sibling) refusals.push({ field: 'siblingLessonId', code: 'SIBLING_UNKNOWN' });
    else if (i.sibling.contentKind !== 'audio') refusals.push({ field: 'siblingLessonId', code: 'SIBLING_NOT_AUDIO' });
    else if (i.sibling.pairedWith !== null && i.sibling.pairedWith !== i.current?.id) refusals.push({ field: 'siblingLessonId', code: 'SIBLING_TAKEN' });
    else siblingStored = `${i.sibling.id} · ${i.sibling.defaultTitle}`;
  }

  // THE THUMBNAIL: a second into THIS lesson's own video.
  const thumbTyped = trimOrNull(i.entered.thumbnailAt);
  let thumbSecs: number | null = null;
  if (thumbTyped !== null) {
    if (kind !== null && kind !== 'video') refusals.push({ field: 'thumbnailAt', code: 'THUMBNAIL_NOT_FOR_KIND' });
    else {
      thumbSecs = parseClock(thumbTyped);
      if (thumbSecs === null) refusals.push({ field: 'thumbnailAt', code: 'THUMBNAIL_INVALID' });
      else if (durationSecs !== null && thumbSecs >= durationSecs) { refusals.push({ field: 'thumbnailAt', code: 'THUMBNAIL_BEYOND_DURATION' }); }
    }
  }

  // CHAPTERS: lines of `mm:ss title`, increasing, inside the duration; only on a lesson that has time.
  const chapTyped = trimOrNull(i.entered.chapters);
  let chapters: LessonChapter[] = [];
  if (chapTyped !== null) {
    if (kind !== null && !TIMED_KINDS.has(kind)) refusals.push({ field: 'chapters', code: 'CHAPTERS_NOT_FOR_KIND' });
    else {
      const parsed = parseChapters(chapTyped, durationSecs);
      chapters = parsed.chapters;
      for (const p of parsed.problems as ChapterProblem[]) refusals.push({ field: 'chapters', code: p });
    }
  }

  const fields: ReviewField[] = [
    // NEVER TYPED, ALWAYS SHOWN: the position the lesson takes.
    field('position', null, moduleNo !== null && lessonNo !== null ? `${moduleNo}·${lessonNo}` : null),
    field('moduleNo', i.entered.moduleNo ?? null, moduleNo === null ? null : String(moduleNo)),
    field('defaultTitle', i.entered.defaultTitle ?? null, title),
    field('contentKind', i.entered.contentKind ?? null, kind),
    field('mediaId', i.entered.mediaId ?? null, mediaStored),
    field('body', i.entered.body ?? null, body),
    field('duration', i.entered.duration ?? null, durationSecs === null ? null : formatClock(durationSecs)),
    field('siblingLessonId', i.entered.siblingLessonId ?? null, siblingStored),
    field('thumbnailAt', i.entered.thumbnailAt ?? null, thumbSecs === null ? null : formatClock(thumbSecs)),
    field('chapters', i.entered.chapters ?? null, chapters.length === 0 ? null : chaptersToText(chapters)),
  ];
  refusals.push(...writerRefusals(i.writerIssues ?? [], fields.map((f) => f.name), refusals));

  let diff: ReviewDiffRow[] | null = null;
  if (isEdit && i.current) {
    diff = [];
    const c = i.current;
    const push = (f: string, before: string | null, after: string | null) => { if (before !== after) diff!.push({ field: f, before, after }); };
    push('defaultTitle', c.defaultTitle, title);
    push('contentKind', c.contentKind, kind);
    push('mediaId', c.mediaId, mediaTyped !== null && i.media ? i.media.id : null);
    push('body', c.body, body);
    push('duration', c.durationSecs === null ? null : formatClock(c.durationSecs), durationSecs === null ? null : formatClock(durationSecs));
    push('siblingLessonId', c.siblingLessonId, sibTyped !== null && i.sibling ? i.sibling.id : null);
    push('thumbnailAt', c.thumbnailFrameSecs === null ? null : formatClock(c.thumbnailFrameSecs), thumbSecs === null ? null : formatClock(thumbSecs));
    push('chapters', c.chapters.length === 0 ? null : chaptersToText(c.chapters), chapters.length === 0 ? null : chaptersToText(chapters));
  }
  return reviewResult('lesson', fields, refusals, diff);
}

/** The row the writer receives when `ready` — the same digits the review showed. */
export function storedLesson(i: LessonReviewInput): LessonStored | null {
  const r = reviewLesson(i);
  if (!r.ready) return null;
  const isEdit = i.current !== undefined;
  const kind = trimOrNull(i.entered.contentKind) as ContentKind;
  const durationSecs = parseClock(trimOrNull(i.entered.duration));
  const chap = trimOrNull(i.entered.chapters);
  return {
    moduleNo: isEdit ? (i.current as CurrentLesson).moduleNo : (trimOrNull(i.entered.moduleNo) === null ? 1 : Number(trimOrNull(i.entered.moduleNo))),
    lessonNo: isEdit ? (i.current as CurrentLesson).lessonNo : i.nextLessonNo,
    defaultTitle: trimOrNull(i.entered.defaultTitle) as string,
    contentKind: kind,
    mediaId: trimOrNull(i.entered.mediaId) !== null && i.media ? i.media.id : null,
    body: trimOrNull(i.entered.body),
    durationSecs,
    siblingLessonId: trimOrNull(i.entered.siblingLessonId) !== null && i.sibling ? i.sibling.id : null,
    thumbnailFrameSecs: parseClock(trimOrNull(i.entered.thumbnailAt)),
    chapters: chap === null ? [] : parseChapters(chap, durationSecs).chapters,
  };
}

/** The form's own view of a stored lesson — the values the EDIT step opens with. */
export function lessonFormValues(c: CurrentLesson): Record<LessonFormField, string> {
  return {
    moduleNo: String(c.moduleNo), defaultTitle: c.defaultTitle, contentKind: c.contentKind, mediaId: c.mediaId ?? '', body: c.body ?? '',
    duration: c.durationSecs === null ? '' : formatClock(c.durationSecs), siblingLessonId: c.siblingLessonId ?? '',
    thumbnailAt: c.thumbnailFrameSecs === null ? '' : formatClock(c.thumbnailFrameSecs), chapters: chaptersToText(c.chapters),
  };
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE SUBTITLE TRACK (W412 "Subtitle tracks — Edit"), the chain's second mode                               */
/* --------------------------------------------------------------------------------------------------------- */

export const SUBTITLE_REVIEW_REFUSALS = [
  'NO_AUTHOR', 'NOT_OWNER', 'COURSE_ARCHIVED', 'LESSON_NOT_FOUND', 'LESSON_READY', 'KIND_HAS_NO_SPEECH',
  'LANGUAGE_REQUIRED', 'LANGUAGE_UNKNOWN', 'BODY_REQUIRED', ...WRITER_REFUSALS,
] as const;
export const SUBTITLE_FORM_FIELDS = ['languageCode', 'body', 'reviewed'] as const;
export type SubtitleFormField = (typeof SUBTITLE_FORM_FIELDS)[number];
export const MAX_SUBTITLE_BODY = 200_000;

export interface SubtitleReviewInput {
  canAuthor: boolean; canPublish: boolean; isOwner: boolean;
  lesson: { contentKind: ContentKind; status: string; courseStatus: string } | null;
  /** The languages this tenant teaches in — `tenant_languages`, or the platform's active languages when it declared none. */
  languages: readonly string[];
  /** The track as it stands for the named language: undefined = none yet; the row otherwise. */
  current: { body: string; status: string } | undefined;
  entered: Partial<Record<SubtitleFormField, string | null | undefined>>;
  writerIssues?: readonly WriterIssue[];
}
export interface SubtitleStored { languageCode: string; body: string; reviewed: boolean }
const truthy = (s: string | null | undefined): boolean => ['1', 'true', 'on', 'yes'].includes((s ?? '').trim().toLowerCase());

export function reviewSubtitle(i: SubtitleReviewInput): ReviewResult {
  const refusals: ReviewRefusal[] = [];
  if (!i.canAuthor && !i.canPublish) refusals.push({ field: null, code: 'NO_AUTHOR' });
  if (!i.isOwner && !i.canPublish) refusals.push({ field: null, code: 'NOT_OWNER' });
  if (!i.lesson) refusals.push({ field: null, code: 'LESSON_NOT_FOUND' });
  else {
    if (i.lesson.courseStatus === 'archived') refusals.push({ field: null, code: 'COURSE_ARCHIVED' });
    if (i.lesson.status === 'ready') refusals.push({ field: null, code: 'LESSON_READY' });
    if (!SPEECH_KINDS.has(i.lesson.contentKind)) refusals.push({ field: null, code: 'KIND_HAS_NO_SPEECH' });
  }
  const lang = trimOrNull(i.entered.languageCode);
  if (lang === null) refusals.push({ field: 'languageCode', code: 'LANGUAGE_REQUIRED' });
  else if (!i.languages.includes(lang)) refusals.push({ field: 'languageCode', code: 'LANGUAGE_UNKNOWN' });
  const body = trimOrNull(i.entered.body);
  if (body === null) refusals.push({ field: 'body', code: 'BODY_REQUIRED' });
  const reviewed = truthy(i.entered.reviewed);
  const fields: ReviewField[] = [
    field('languageCode', i.entered.languageCode ?? null, lang !== null && i.languages.includes(lang) ? lang : null),
    // The body is long; the review shows its size, not the text — the text is what the form step already shows.
    field('body', body === null ? null : `${body.length}`, body === null ? null : `${body.length}`),
    field('reviewed', i.entered.reviewed ?? null, reviewed ? 'reviewed' : 'draft'),
  ];
  refusals.push(...writerRefusals(i.writerIssues ?? [], fields.map((f) => f.name), refusals));
  let diff: ReviewDiffRow[] | null = null;
  if (i.current) {
    diff = [];
    if (i.current.body !== body) diff.push({ field: 'body', before: `${i.current.body.length}`, after: body === null ? null : `${body.length}` });
    const after = reviewed ? 'reviewed' : 'draft';
    if (i.current.status !== after) diff.push({ field: 'reviewed', before: i.current.status, after });
  }
  return reviewResult('lesson', fields, refusals, diff);
}
export function storedSubtitle(i: SubtitleReviewInput): SubtitleStored | null {
  if (!reviewSubtitle(i).ready) return null;
  return { languageCode: trimOrNull(i.entered.languageCode) as string, body: trimOrNull(i.entered.body) as string, reviewed: truthy(i.entered.reviewed) };
}
