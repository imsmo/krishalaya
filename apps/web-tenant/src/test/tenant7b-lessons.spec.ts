// apps/web-tenant/src/test/tenant7b-lessons.spec.ts · PC-56 TENANT-7b · the lesson record's console helpers, and the
// catalogue promise that every key a page can ask for exists ×3 — for every lesson kind, status, coverage mark,
// media state, act, act refusal, page state, and every refusal code the API's three reviewers can emit.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CourseGateCheck, LessonActVerdict, LessonView } from '@krishalaya/sdk-js';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  CONTENT_KINDS, HEADER_ACTS, LESSON_FORM, LESSON_FORM_FIELDS, MAX_CARRIED_LENGTH_LESSON, MAX_LONG_TEXT, QUESTION_FORM, QUESTION_FORM_FIELDS, QUIZ_MAX_OPTIONS, ROW_ACTS,
  SUBTITLE_FORM, SUBTITLE_FORM_FIELDS, answerNumber, canServe, clockText, coverageKey, coverageMark, editLessonHref, formMode, formOf, gateRowKey, kindKey,
  lessonActDoneKey, lessonActHref, lessonActLabelKey, lessonCompletionText, lessonFormDoneKey, lessonHref, lessonPageStateKey, lessonStatusKey, lessonTransportState,
  lessonVerdictFor, mediaState, mediaStateKey, newLessonHref, offeredLessonActs, outlineHref, outlineSummary, positionText, questionHref, questionNo, refusedLessonActs,
  retryIsMutation, retryRefusedKey, reuploadHref, subtitleHref, thumbnailKey, thumbnailRenderedIsClaimed, voiceRefusedKey,
} from '../features/courses/lessons';
import { carryValues, readCarried } from '../features/forms/chain';
import { fieldLabelKey, refusalKey } from '../features/forms/chain';
import { mutateRefusalKey } from '../features/mutate/chain';

const three = (k: string) => { for (const [n, cat] of [['en', en], ['hi', hi], ['gu', gu]] as const) expect(cat[k as keyof typeof cat] ? `${n}` : `${n} MISSING ${k}`).toBe(n); };
const api = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../api/src/modules/education/domain', rel), 'utf8');
function apiList(file: string, constName: string): string[] {
  const src = api(file);
  const i = src.indexOf(`${constName} = [`);
  if (i < 0) throw new Error(`${constName} not in ${file}`);
  return [...src.slice(i, src.indexOf('] as const', i)).matchAll(/'([A-Za-z_]+)'/g)].map((m) => m[1]);
}
const V = (o: Partial<LessonView['lesson']> = {}, subtitles: LessonView['subtitles'] = {}): LessonView => ({
  lesson: { id: 'l', courseId: 'c', moduleNo: 1, lessonNo: 1, defaultTitle: 'x', contentKind: 'video', mediaId: 'm', body: null, durationSecs: 500, quiz: null, status: 'draft', siblingLessonId: null, ...o },
  position: 1, subtitles, stats: null,
});

describe('PC-56 TENANT-7b · routes — every canon clickable has an href, and the chains carry their meta', () => {
  it('outline, record, form (new · edit · subtitle), act, question', () => {
    expect(outlineHref('c 1')).toBe('/courses/c%201/outline');
    expect(lessonHref('c', 'l')).toBe('/courses/c/lessons/l');
    expect(newLessonHref('c')).toBe('/courses/c/lessons/new'); expect(newLessonHref('c', 2)).toBe('/courses/c/lessons/new?moduleNo=2');
    expect(editLessonHref('c', 'l')).toBe('/courses/c/lessons/new?lesson=l');
    expect(subtitleHref('c', 'l', 'gu')).toBe('/courses/c/lessons/new?lesson=l&mode=subtitle&languageCode=gu');
    expect(lessonActHref('c', 'l', 'move_up')).toBe('/courses/c/lessons/l/act?step=confirm&act=move_up');
    expect(questionHref('c', 'l', 3)).toBe('/courses/c/lessons/l/quiz?n=3');
    expect(reuploadHref('c', 'l')).toBe(editLessonHref('c', 'l'));   // W412 "Re-upload" is the FORM chain, never a job
    expect(retryIsMutation()).toBe(false); expect(thumbnailRenderedIsClaimed()).toBe(false);
  });
  it('the clock is display only: mm:ss, h:mm:ss past an hour, nothing for nothing', () => {
    expect(clockText(500)).toBe('08:20'); expect(clockText(2530)).toBe('42:10'); expect(clockText(3734)).toBe('1:02:14'); expect(clockText(0)).toBe('00:00');
    expect(clockText(null)).toBeNull(); expect(clockText(undefined)).toBeNull(); expect(clockText(-1)).toBeNull();
  });
});

describe('PC-56 TENANT-7b · W411 — coverage marks, the footer counts, and the learner reality', () => {
  it('coverage: reviewed ✓, draft …, missing —, and n/a for a lesson with no speech', () => {
    expect(coverageMark(V({}, { gu: 'reviewed' }), 'gu')).toBe('reviewed');
    expect(coverageMark(V({}, { gu: 'draft' }), 'gu')).toBe('draft');
    expect(coverageMark(V({}, { gu: 'reviewed' }), 'en')).toBe('missing');
    expect(coverageMark(V({ contentKind: 'pdf' }, { gu: 'reviewed' }), 'gu')).toBe('not_applicable');
    expect(coverageMark(V({ contentKind: 'live' }), 'gu')).toBe('missing');
    for (const m of ['reviewed', 'draft', 'missing', 'not_applicable'] as const) three(coverageKey(m));
  });
  it('the footer: lessons · video ↔ paired · per-language met/of over SPEECH lessons only, in integers', () => {
    const rows = [V({ id: 'a', siblingLessonId: 'b' }, { gu: 'reviewed', hi: 'reviewed', en: 'reviewed' }), V({ id: 'b', contentKind: 'audio' }, { gu: 'reviewed', hi: 'reviewed', en: 'draft' }), V({ id: 'c', contentKind: 'video' }, { gu: 'reviewed' }), V({ id: 'd', contentKind: 'pdf' })];
    expect(outlineSummary(rows, ['gu', 'hi', 'en'])).toEqual({ lessons: 4, videos: 2, paired: 1, coverage: [{ lang: 'gu', met: 3, of: 3 }, { lang: 'hi', met: 2, of: 3 }, { lang: 'en', met: 1, of: 3 }] });
    expect(outlineSummary([], ['gu'])).toEqual({ lessons: 0, videos: 0, paired: 0, coverage: [{ lang: 'gu', met: 0, of: 0 }] });
    expect(outlineSummary(rows, [])).toMatchObject({ coverage: [] });
  });
  it('completion is completed/started and NOTHING for a lesson nobody opened; position is module·position', () => {
    expect(lessonCompletionText(null)).toBeNull(); expect(lessonCompletionText({ lessonId: 'l', started: 0, completed: 0 })).toBeNull();
    expect(lessonCompletionText({ lessonId: 'l', started: 7, completed: 3 })).toBe('3/7');
    expect(positionText({ lesson: V({ moduleNo: 2 }).lesson, position: 5 })).toBe('2·5');
  });
  it('every kind and status has a word ×3, and the kinds are the API\'s six', () => {
    expect([...CONTENT_KINDS]).toEqual(apiList('education.events.ts', 'CONTENT_KINDS'));
    for (const k of CONTENT_KINDS) three(kindKey(k));
    for (const s of ['draft', 'ready']) three(lessonStatusKey(s));
    expect(lessonStatusKey(undefined)).toBe('lessons.status.draft');
  });
});

describe('PC-56 TENANT-7b · W412 — what is stored, what is served, what is refused by name', () => {
  const m = (scanStatus: string) => ({ id: 'm', kind: 'video', scanStatus, mimeType: 'video/mp4', bytes: '1', durationSecs: null });
  it('the media state is the SCAN state: none · awaiting_scan · clean · blocked; only clean is servable', () => {
    expect(mediaState(null)).toBe('none'); expect(mediaState(m('pending'))).toBe('awaiting_scan'); expect(mediaState(m('clean'))).toBe('clean');
    expect(mediaState(m('infected'))).toBe('blocked'); expect(mediaState(m('failed'))).toBe('blocked');
    expect(canServe(m('clean'))).toBe(true); expect(canServe(m('pending'))).toBe(false); expect(canServe(null)).toBe(false);
    for (const s of ['none', 'awaiting_scan', 'clean', 'blocked'] as const) three(mediaStateKey(s));
  });
  it('the thumbnail is a declaration with a time, or none; Retry and Record-by-voice are refused by name with a sentence ×3 that says "Not built"', () => {
    expect(thumbnailKey(151)).toBe('lessons.thumbnail.declared'); expect(thumbnailKey(null)).toBe('lessons.thumbnail.none'); expect(thumbnailKey(undefined)).toBe('lessons.thumbnail.none');
    for (const k of [thumbnailKey(1), thumbnailKey(null), retryRefusedKey(), voiceRefusedKey(), 'lessons.twin.honest', 'lessons.thumbnail.honest', 'lessons.media.honest', 'lessons.empty.templateNamed']) three(k);
    for (const k of [retryRefusedKey(), voiceRefusedKey(), 'lessons.twin.honest', 'lessons.empty.templateNamed']) expect(en[k as keyof typeof en]).toMatch(/^Not built:/);
    expect(en[thumbnailKey(1) as keyof typeof en]).toContain('{at}');
  });
});

describe('PC-56 TENANT-7b · the acts — offered when allowed, printed with a reason when not; every code has a sentence ×3', () => {
  const acts: LessonActVerdict[] = [
    { act: 'ready', allowed: false, refusals: ['HOLLOW', 'MEDIA_NOT_CLEAN'], to: 'ready' }, { act: 'reopen', allowed: false, refusals: ['ILLEGAL_FROM_STATUS'], to: 'draft' },
    { act: 'move_up', allowed: false, refusals: ['AT_TOP'], to: null }, { act: 'move_down', allowed: true, refusals: [], to: null },
  ];
  it('offered / refused / verdictFor', () => {
    expect(offeredLessonActs(acts).map((a) => a.act)).toEqual(['move_down']);
    expect(refusedLessonActs(acts).map((a) => a.act)).toEqual(['ready', 'reopen', 'move_up']);
    expect(lessonVerdictFor(acts, 'ready')?.refusals).toEqual(['HOLLOW', 'MEDIA_NOT_CLEAN']); expect(lessonVerdictFor([], 'ready')).toBeNull();
    expect([...HEADER_ACTS, ...ROW_ACTS].sort()).toEqual([...apiList('lesson-acts.ts', 'LESSON_ACTS')].sort());
  });
  it('labels, done sentences and refusal sentences ×3 for every act and refusal the API can emit', () => {
    for (const a of apiList('lesson-acts.ts', 'LESSON_ACTS')) { three(lessonActLabelKey(a as LessonActVerdict['act'])); three(lessonActDoneKey(a as LessonActVerdict['act'])); }
    for (const r of apiList('lesson-acts.ts', 'LESSON_ACT_REFUSALS')) three(mutateRefusalKey('lesson', r));
    for (const k of ['mutate.lesson.title', 'mutate.lesson.noAct', 'mutate.lesson.object', 'mutate.lesson.transition', 'mutate.lesson.moveNote', 'mutate.lesson.readyNote', 'mutate.lesson.reopenNote', 'mutate.lesson.reasonLabel']) three(k);
  });
});

describe('PC-56 TENANT-7b · page states and the gate rows', () => {
  it('a transport failure is one of W411/W412\'s own states', () => {
    expect(lessonTransportState('EDUCATION_FORBIDDEN')).toBe('restricted'); expect(lessonTransportState(null, 403)).toBe('restricted');
    expect(lessonTransportState('COURSE_NOT_FOUND')).toBe('notFound'); expect(lessonTransportState('LESSON_NOT_FOUND')).toBe('notFound');
    expect(lessonTransportState('FEATURE_DISABLED')).toBe('notEnabled'); expect(lessonTransportState(null, 404)).toBe('notEnabled');
    expect(lessonTransportState('SOMETHING')).toBe('error'); expect(lessonTransportState(null)).toBe('error');
    for (const s of ['notEnabled', 'restricted', 'notFound', 'error', 'readOnly'] as const) three(lessonPageStateKey(s));
    for (const k of ['lessons.state.videoRestricted', 'lessons.state.quizRestricted', 'lessons.state.notEnabledHint']) three(k);
  });
  it('W416\'s SUBTITLES row is keyed per language; every 7b gate code has a name ×3', () => {
    const c = (o: Partial<CourseGateCheck>): CourseGateCheck => ({ code: 'HAS_LESSONS', state: 'pass', measured: null, named: [], declared: null, ...o });
    expect(gateRowKey(c({ code: 'SUBTITLES', lang: 'gu' }))).toBe('SUBTITLES:gu'); expect(gateRowKey(c({ code: 'SUBTITLES' }))).toBe('SUBTITLES:'); expect(gateRowKey(c({ code: 'AUDIO_SIBLINGS', lang: 'gu' }))).toBe('AUDIO_SIBLINGS');
    for (const code of apiList('course-publish-gate.ts', 'GATE_CHECKS')) three(`courses.gate.${code}`);
    three('courses.gateNote.THUMBNAILS_REAL');
  });
});

describe('PC-56 TENANT-7b · the three form chains — fields are the API\'s, every refusal has a sentence ×3, long texts declare their ceiling', () => {
  it('lesson · subtitle · question field lists mirror the API and every field has a label ×3', () => {
    expect([...LESSON_FORM_FIELDS]).toEqual(apiList('lesson-review.ts', 'LESSON_FORM_FIELDS'));
    expect([...SUBTITLE_FORM_FIELDS]).toEqual(apiList('lesson-review.ts', 'SUBTITLE_FORM_FIELDS'));
    expect(QUESTION_FORM_FIELDS).toHaveLength(3 + 2 * QUIZ_MAX_OPTIONS);
    expect(api('quiz.ts')).toContain(`MAX_OPTIONS = ${QUIZ_MAX_OPTIONS}`);
    for (const f of [...LESSON_FORM_FIELDS, 'position']) three(fieldLabelKey(LESSON_FORM, f));
    for (const f of SUBTITLE_FORM_FIELDS) three(fieldLabelKey(SUBTITLE_FORM, f));
    for (const f of QUESTION_FORM_FIELDS) three(fieldLabelKey(QUESTION_FORM, f));
  });
  it('every refusal the three reviewers can emit has a sentence ×3', () => {
    for (const r of apiList('lesson-review.ts', 'LESSON_REVIEW_REFUSALS')) three(refusalKey(LESSON_FORM, r));
    for (const r of apiList('lesson-review.ts', 'SUBTITLE_REVIEW_REFUSALS')) three(refusalKey(SUBTITLE_FORM, r));
    for (const r of apiList('quiz.ts', 'QUESTION_REVIEW_REFUSALS')) three(refusalKey(QUESTION_FORM, r));
    for (const r of ['TOO_LONG', 'VALUE_REJECTED']) { three(refusalKey(LESSON_FORM, r)); three(refusalKey(SUBTITLE_FORM, r)); three(refusalKey(QUESTION_FORM, r)); }
  });
  it('modes, done keys, the question number, the answer as a NUMBER', () => {
    expect(formMode('subtitle')).toBe('subtitle'); expect(formMode('anything')).toBe('lesson'); expect(formMode(undefined)).toBe('lesson');
    expect(formOf('subtitle')).toEqual({ form: 'subtitle', fields: SUBTITLE_FORM_FIELDS }); expect(formOf('lesson')).toEqual({ form: 'lesson', fields: LESSON_FORM_FIELDS });
    expect(lessonFormDoneKey('lesson', false)).toBe('form.lesson.created'); expect(lessonFormDoneKey('lesson', true)).toBe('form.lesson.updated'); expect(lessonFormDoneKey('subtitle', true)).toBe('form.subtitle.saved');
    for (const k of ['form.lesson.created', 'form.lesson.updated', 'form.subtitle.saved', 'form.lesson.title', 'form.lesson.editTitle', 'form.subtitle.title', 'form.question.title', 'form.question.editTitle', 'form.question.saved']) three(k);
    expect(questionNo('2', 3)).toBe(2); expect(questionNo('4', 3)).toBe(4); expect(questionNo('5', 3)).toBe(4); expect(questionNo('0', 3)).toBe(4); expect(questionNo(undefined, 0)).toBe(1); expect(questionNo('x', 2)).toBe(3);
    expect(answerNumber(0)).toBe('1'); expect(answerNumber(2)).toBe('3'); expect(answerNumber(null)).toBe(''); expect(answerNumber(undefined)).toBe('');
  });
  it('a link carries the long chain\'s values up to its own ceiling, and the textarea ceiling stays under it', () => {
    expect(MAX_LONG_TEXT).toBeLessThan(MAX_CARRIED_LENGTH_LESSON); expect(MAX_CARRIED_LENGTH_LESSON).toBeLessThanOrEqual(7_000);
    const long = 'x'.repeat(3_000);
    expect(carryValues('review', { body: long }).preserved).toBe(false);                            // the shared ceiling refuses it
    expect(carryValues('review', { body: long }, MAX_CARRIED_LENGTH_LESSON).preserved).toBe(true);  // the lesson chain carries it
    expect(carryValues('review', { body: 'x'.repeat(MAX_CARRIED_LENGTH_LESSON) }, MAX_CARRIED_LENGTH_LESSON).preserved).toBe(false);
    expect(en['form.subtitle.bodyHint']).toContain('{n}'); expect(en['form.lesson.bodyHint']).toContain('{n}');
  });
  it('two inputs sharing a name (the typed media id beside the uploader\'s): the first NON-BLANK value wins', () => {
    expect(readCarried({ mediaId: ['', 'abc'] }, ['mediaId'])).toEqual({ mediaId: 'abc' });
    expect(readCarried({ mediaId: ['typed', 'abc'] }, ['mediaId'])).toEqual({ mediaId: 'typed' });
    expect(readCarried({ mediaId: ['', '  '] }, ['mediaId'])).toEqual({});
    expect(readCarried({ mediaId: ' one ' }, ['mediaId'])).toEqual({ mediaId: 'one' });
  });
});
