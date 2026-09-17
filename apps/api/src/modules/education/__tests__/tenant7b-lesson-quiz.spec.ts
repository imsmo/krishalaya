// modules/education/__tests__/tenant7b-lesson-quiz.spec.ts · PC-56 TENANT-7b · the lesson record's pure logic.
//
// Six pure modules, one rule each:
//   • lesson-clock       — `8:20` → 500 s → `08:20`; chapters are increasing marks inside the lesson.
//   • quiz               — explanations on every option, a threshold in integers, scoring with no float on the boundary.
//   • lesson-reorder     — a move is a plan of the rows whose number changes, and only those.
//   • lesson-acts        — four verdicts in the order permission → owner → course stage → lesson stage → gaps → reason.
//   • lesson-review      — the lesson form and the subtitle form are DECISIONS (what will be stored, every refusal).
//   • course-publish-gate — the six checks 7a printed `not_measured` are measured and block, naming lessons.
import { MAX_CHAPTERS, chaptersToText, formatClock, parseChapters, parseClock } from '../domain/lesson-clock';
import {
  MAX_OPTIONS, MIN_OPTIONS, QUESTION_FORM_FIELDS, QuestionReviewInput, missingExplanations, neededCorrect, parsePassingPct, quizWellFormed, readQuiz,
  reviewQuestion, scoreQuiz, storedQuestion,
} from '../domain/quiz';
import { planMove, positionOf, renumber } from '../domain/lesson-reorder';
import { LESSON_ACTS, LESSON_ACT_REFUSALS, LessonActInput, allLessonVerdicts, isLessonAct, lessonActVerdict } from '../domain/lesson-acts';
import {
  LESSON_FORM_FIELDS, LESSON_REVIEW_REFUSALS, LessonReviewInput, SUBTITLE_REVIEW_REFUSALS, SubtitleReviewInput, lessonFormValues, reviewLesson, reviewSubtitle, storedLesson,
  storedSubtitle,
} from '../domain/lesson-review';
import { GateLesson, computeGate, thumbnailDeclared } from '../domain/course-publish-gate';
import { canLessonTransition, isLessonStatus } from '../domain/lesson.state';
import { CourseLesson } from '../domain/course-lesson.entity';

describe('PC-56 TENANT-7b · the clock — what a person types and what the row keeps', () => {
  it('parses mm:ss, h:mm:ss and bare seconds; refuses signs, fractions, 60 seconds and beyond a day', () => {
    expect(parseClock('8:20')).toBe(500); expect(parseClock('08:20')).toBe(500); expect(parseClock('1:02:14')).toBe(3734);
    expect(parseClock('500')).toBe(500); expect(parseClock(' 00:00 ')).toBe(0);
    expect(parseClock('8:60')).toBeNull(); expect(parseClock('-8:20')).toBeNull(); expect(parseClock('8.5')).toBeNull(); expect(parseClock('')).toBeNull(); expect(parseClock(null)).toBeNull();
    expect(parseClock('25:00:00')).toBeNull(); expect(parseClock('86400')).toBe(86400); expect(parseClock('86401')).toBeNull(); expect(parseClock('1:60:00')).toBeNull();
    expect(parseClock('120:00')).toBe(7200);   // minutes past the hour are a person's habit; the row keeps seconds
  });
  it('formats the canon\'s mm:ss and h:mm:ss past an hour; never negative', () => {
    expect(formatClock(500)).toBe('08:20'); expect(formatClock(2530)).toBe('42:10'); expect(formatClock(3734)).toBe('1:02:14'); expect(formatClock(0)).toBe('00:00'); expect(formatClock(-5)).toBe('00:00');
    expect(formatClock(parseClock('7:52') as number)).toBe('07:52');
  });
  it('chapters: `mm:ss — title` lines, increasing, inside the duration; EVERY problem reported', () => {
    const ok = parseChapters('00:00 — Why colostrum, in the first hour\n02:14 How much, how often\n04:50 - Common mistakes', 405);
    expect(ok.problems).toEqual([]); expect(ok.chapters).toEqual([{ at: 0, title: 'Why colostrum, in the first hour' }, { at: 134, title: 'How much, how often' }, { at: 290, title: 'Common mistakes' }]);
    expect(chaptersToText(ok.chapters)).toBe('00:00 — Why colostrum, in the first hour\n02:14 — How much, how often\n04:50 — Common mistakes');
    const bad = parseChapters('02:14 second\n00:00 first\nnonsense\n09:00 beyond\n', 405);
    expect(bad.problems.sort()).toEqual(['CHAPTER_BEYOND_DURATION', 'CHAPTER_LINE_INVALID', 'CHAPTER_ORDER']);
    expect(parseChapters('00:00', 405).problems).toEqual(['CHAPTER_LINE_INVALID']);   // a mark with no title
    expect(parseChapters('06:45 at the very end', 405).problems).toEqual(['CHAPTER_BEYOND_DURATION']);   // a mark AT the duration is beyond the lesson
    expect(parseChapters('00:00 a\n00:00 b', null).problems).toEqual(['CHAPTER_ORDER']);   // equal marks are not increasing
    expect(parseChapters(`00:10 ${'x'.repeat(121)}`, null).problems).toEqual(['CHAPTER_TITLE_LONG']);
    expect(parseChapters(Array.from({ length: MAX_CHAPTERS + 1 }, (_, i) => `${formatClock(i * 10)} c${i}`).join('\n'), null).problems).toEqual(['CHAPTER_LINE_INVALID']);
    expect(parseChapters('', 10)).toEqual({ chapters: [], problems: [] });
    // with no duration known, a mark cannot be "beyond" it
    expect(parseChapters('59:00 late', null).problems).toEqual([]);
  });
});

const Q = (o: Partial<{ q: string; options: string[]; answer: number; explanations: string[] }> = {}) => ({ q: 'How soon?', options: ['1 hour', '6 hours', '24 hours'], answer: 0, explanations: ['Correct — first hour', 'Too late', 'Much too late'], ...o });

describe('PC-56 TENANT-7b · the quiz — a mirror, not a wall', () => {
  it('reads the stored JSON leniently (explanations absent = []), refuses a shape the learner parser would', () => {
    expect(readQuiz({ questions: [{ q: 'a', options: ['x', 'y'], answer: 1 }] })).toEqual({ questions: [{ q: 'a', options: ['x', 'y'], answer: 1, explanations: [] }] });
    expect(readQuiz(null)).toBeNull(); expect(readQuiz({ questions: 'no' })).toBeNull(); expect(readQuiz({ questions: [{ q: 1, options: ['x', 'y'], answer: 0 }] })).toBeNull();
    expect(readQuiz({ questions: [{ q: 'a', options: ['x', 2], answer: 0 }] })).toBeNull(); expect(readQuiz({ questions: [{ q: 'a', options: ['x', 'y'], answer: 0.5 }] })).toBeNull();
    expect(readQuiz({ questions: [{ q: 'a', options: ['x', 'y'], answer: 0, explanations: ['e', 7] }] })?.questions[0].explanations).toEqual(['e', '']);
    expect(quizWellFormed(readQuiz({ questions: [] }))).toBe(false);
    expect(quizWellFormed(readQuiz({ questions: [{ q: 'a', options: ['x'], answer: 0 }] }))).toBe(false);
    expect(quizWellFormed(readQuiz({ questions: [{ q: 'a', options: ['x', 'y'], answer: 2 }] }))).toBe(false);
    expect(quizWellFormed(readQuiz({ questions: [Q()] }))).toBe(true);
    expect(quizWellFormed(null)).toBe(false);
  });
  it('names every option without an explanation, 1-based, across questions', () => {
    expect(missingExplanations({ questions: [Q(), Q({ explanations: ['a', '', '  '] })] })).toEqual([{ question: 2, option: 2 }, { question: 2, option: 3 }]);
    expect(missingExplanations({ questions: [Q({ explanations: [] })] })).toEqual([{ question: 1, option: 1 }, { question: 1, option: 2 }, { question: 1, option: 3 }]);
    expect(missingExplanations(null)).toEqual([]);
  });
  it('threshold: `70`, `70%` → 70; refuses 101, -1, 7.5, blank', () => {
    expect(parsePassingPct('70')).toBe(70); expect(parsePassingPct('70%')).toBe(70); expect(parsePassingPct(' 0 ')).toBe(0); expect(parsePassingPct('100')).toBe(100);
    expect(parsePassingPct('101')).toBeNull(); expect(parsePassingPct('-1')).toBeNull(); expect(parsePassingPct('7.5')).toBeNull(); expect(parsePassingPct('')).toBeNull(); expect(parsePassingPct('%')).toBeNull();
  });
  it('scoring: integers only, pass on the boundary, no negative marking, unanswered is wrong', () => {
    const doc = { questions: [Q(), Q({ answer: 1 }), Q({ answer: 2 })] };
    expect(neededCorrect(3, 70)).toBe(3); expect(neededCorrect(3, 60)).toBe(2); expect(neededCorrect(0, 70)).toBe(0); expect(neededCorrect(5, 0)).toBe(0); expect(neededCorrect(12, 100)).toBe(12);
    expect(scoreQuiz(doc, [0, 1, 2], 70)).toEqual({ correct: 3, total: 3, scorePct: 100, passed: true });
    expect(scoreQuiz(doc, [0, 1, 0], 70)).toEqual({ correct: 2, total: 3, scorePct: 66, passed: false });
    expect(scoreQuiz(doc, [0, 1, 0], 66)).toEqual({ correct: 2, total: 3, scorePct: 66, passed: true });   // 200 ≥ 198 — integers, no 66.66 vs 66.67
    expect(scoreQuiz(doc, [0, 1, 0], 67)).toEqual({ correct: 2, total: 3, scorePct: 66, passed: false });  // 200 < 201
    expect(scoreQuiz(doc, [null, undefined, 2], 30)).toEqual({ correct: 1, total: 3, scorePct: 33, passed: true });
    expect(scoreQuiz(doc, [], 0)).toEqual({ correct: 0, total: 3, scorePct: 0, passed: true });
    expect(scoreQuiz({ questions: [] }, [], 0)).toEqual({ correct: 0, total: 0, scorePct: 0, passed: false });
    expect(scoreQuiz(doc, [2, 2, 1], 50).correct).toBe(0);   // wrong answers subtract nothing
  });

  const lesson = (o: Partial<NonNullable<QuestionReviewInput['lesson']>> = {}): QuestionReviewInput['lesson'] => ({ contentKind: 'quiz', status: 'draft', courseStatus: 'draft', quiz: { questions: [Q()] }, passingPct: 70, ...o });
  const R = (entered: QuestionReviewInput['entered'], o: Partial<QuestionReviewInput> = {}) => reviewQuestion({ canAuthor: true, canPublish: false, isOwner: true, lesson: lesson(), questionNo: 2, entered, ...o });
  const FULL = { q: 'How soon after calving?', opt1: 'Within 1 hour', expl1: 'Correct — the gut absorbs antibodies in the first hour', opt2: 'Within 6 hours', expl2: 'Too late', opt3: 'Within 24 hours', expl3: 'Much too late', answer: '1', passingPct: '70%' };
  it('the form carries q, six options, six explanations, the answer and the threshold — every refusal names a row', () => {
    expect(QUESTION_FORM_FIELDS).toHaveLength(3 + 2 * MAX_OPTIONS); expect(MIN_OPTIONS).toBe(2);
    const r = R(FULL);
    expect(r.ready).toBe(true); expect(r.refusals).toEqual([]);
    expect(r.fields.find((f) => f.name === 'passingPct')).toEqual({ name: 'passingPct', entered: '70%', stored: '70%', normalised: false });
    expect(r.fields.find((f) => f.name === 'answer')?.stored).toBe('1');
    expect(r.diff).toBeNull();   // an append, and the threshold unchanged
    for (const f of r.fields) expect(QUESTION_FORM_FIELDS).toContain(f.name);
  });
  it('W413: "each needs an explanation (mandatory)" — every missing one is named; a gap in the options is a refusal; the answer must be an option', () => {
    const r = R({ ...FULL, expl2: '', expl3: '  ', answer: '3' });
    expect(r.refusals).toEqual([{ field: 'expl2', code: 'EXPLANATION_REQUIRED' }, { field: 'expl3', code: 'EXPLANATION_REQUIRED' }]);
    expect(R({ ...FULL, opt2: '' }).refusals).toEqual([{ field: 'opt2', code: 'OPTION_GAP' }]);
    expect(R({ ...FULL, answer: '4' }).refusals).toEqual([{ field: 'answer', code: 'ANSWER_NOT_AN_OPTION' }]);
    expect(R({ ...FULL, answer: '0' }).refusals).toEqual([{ field: 'answer', code: 'ANSWER_NOT_AN_OPTION' }]);
    expect(R({ ...FULL, answer: '' }).refusals).toEqual([{ field: 'answer', code: 'ANSWER_REQUIRED' }]);
    expect(R({ ...FULL, q: ' ' }).refusals).toEqual([{ field: 'q', code: 'QUESTION_REQUIRED' }]);
    // W413's empty state: "Add at least one answer option" — and one is not a question anybody can get wrong
    expect(R({ q: 'x', opt1: 'only', expl1: 'e', answer: '1', passingPct: '70' }).refusals).toEqual([{ field: 'opt1', code: 'OPTIONS_MIN' }]);
    expect(R({ q: 'x', answer: '1' }).refusals).toEqual([{ field: 'opt1', code: 'OPTIONS_MIN' }, { field: 'answer', code: 'ANSWER_NOT_AN_OPTION' }]);
  });
  it('the threshold: blank keeps the current one, the first question must declare it, a bad one is refused', () => {
    expect(R({ ...FULL, passingPct: '' }).fields.find((f) => f.name === 'passingPct')?.stored).toBe('70%');
    expect(R({ ...FULL, passingPct: '' }, { lesson: lesson({ quiz: null, passingPct: null }), questionNo: 1 }).refusals).toEqual([{ field: 'passingPct', code: 'THRESHOLD_REQUIRED' }]);
    expect(R({ ...FULL, passingPct: '120' }).refusals).toEqual([{ field: 'passingPct', code: 'THRESHOLD_INVALID' }]);
    // a changed threshold on an append shows as the diff
    expect(R({ ...FULL, passingPct: '60' }).diff).toEqual([{ field: 'passingPct', before: '70%', after: '60%' }]);
  });
  it('permission, ownership, the course\'s and the lesson\'s stage, the kind, the question number', () => {
    expect(R(FULL, { canAuthor: false }).refusals).toEqual([{ field: null, code: 'NO_AUTHOR' }]);
    expect(R(FULL, { isOwner: false }).refusals).toEqual([{ field: null, code: 'NOT_OWNER' }]);
    expect(R(FULL, { isOwner: false, canPublish: true }).ready).toBe(true);   // the desk edits any course of the tenant
    expect(R(FULL, { lesson: null }).refusals).toEqual([{ field: null, code: 'LESSON_NOT_FOUND' }, { field: null, code: 'QUESTION_NOT_FOUND' }]);
    expect(R(FULL, { lesson: lesson({ courseStatus: 'archived' }) }).refusals).toEqual([{ field: null, code: 'COURSE_ARCHIVED' }]);
    expect(R(FULL, { lesson: lesson({ contentKind: 'video' }) }).refusals).toEqual([{ field: null, code: 'NOT_A_QUIZ' }]);
    expect(R(FULL, { lesson: lesson({ status: 'ready' }) }).refusals).toEqual([{ field: null, code: 'LESSON_READY' }]);
    expect(R(FULL, { questionNo: 3 }).refusals).toEqual([{ field: null, code: 'QUESTION_NOT_FOUND' }]);
    expect(R(FULL, { questionNo: 0 }).refusals).toEqual([{ field: null, code: 'QUESTION_NOT_FOUND' }]);
    expect(R(FULL, { questionNo: 51, lesson: lesson({ quiz: { questions: Array.from({ length: 50 }, () => Q()) } }) }).refusals).toEqual([{ field: null, code: 'TOO_MANY_QUESTIONS' }]);
    for (const r of R(FULL, { canAuthor: false, lesson: null }).refusals) expect(QUESTION_REVIEW_REFUSALS_ALL).toContain(r.code);
  });
  it('an EDIT shows the diff of changed rows only, and the write replaces that question; an append adds one', () => {
    const stored1 = { q: 'How soon after calving?', options: ['Within 1 hour', 'Within 6 hours', 'Within 24 hours'], answer: 0, explanations: ['Correct — the gut absorbs antibodies in the first hour', 'Too late', 'Much too late'] };
    const withQ1 = lesson({ quiz: { questions: [stored1] } });
    expect(R(FULL, { questionNo: 1, lesson: withQ1 }).diff).toEqual([]);   // the same question again: nothing changed
    const r = R({ ...FULL, opt2: 'Within 6 hours (edited)', expl3: 'Much too late — see the first chapter' }, { questionNo: 1, lesson: withQ1 });
    expect(r.ready).toBe(true);
    expect(r.diff).toEqual([{ field: 'opt2', before: 'Within 6 hours', after: 'Within 6 hours (edited)' }, { field: 'expl3', before: 'Much too late', after: 'Much too late — see the first chapter' }]);
    const edited = storedQuestion({ canAuthor: true, canPublish: false, isOwner: true, lesson: lesson(), questionNo: 1, entered: { ...FULL, opt2: 'Within 6 hours (edited)' } });
    expect(edited?.doc.questions).toHaveLength(1); expect(edited?.doc.questions[0].options[1]).toBe('Within 6 hours (edited)'); expect(edited?.passingPct).toBe(70);
    const appended = storedQuestion({ canAuthor: true, canPublish: false, isOwner: true, lesson: lesson(), questionNo: 2, entered: { ...FULL, passingPct: '65' } });
    expect(appended?.doc.questions).toHaveLength(2); expect(appended?.doc.questions[1]).toEqual({ q: 'How soon after calving?', options: ['Within 1 hour', 'Within 6 hours', 'Within 24 hours'], answer: 0, explanations: ['Correct — the gut absorbs antibodies in the first hour', 'Too late', 'Much too late'] });
    expect(appended?.passingPct).toBe(65); expect(appended?.questionNo).toBe(2);
    expect(storedQuestion({ canAuthor: true, canPublish: false, isOwner: true, lesson: lesson(), questionNo: 2, entered: { ...FULL, expl1: '' } })).toBeNull();
  });
});
const QUESTION_REVIEW_REFUSALS_ALL: readonly string[] = ['NO_AUTHOR', 'NOT_OWNER', 'COURSE_ARCHIVED', 'LESSON_NOT_FOUND', 'NOT_A_QUIZ', 'LESSON_READY', 'QUESTION_NOT_FOUND', 'QUESTION_REQUIRED', 'OPTIONS_MIN', 'OPTION_GAP', 'ANSWER_REQUIRED', 'ANSWER_NOT_AN_OPTION', 'EXPLANATION_REQUIRED', 'THRESHOLD_INVALID', 'THRESHOLD_REQUIRED', 'TOO_MANY_QUESTIONS', 'TOO_LONG', 'VALUE_REJECTED'];

describe('PC-56 TENANT-7b · the reorder — a plan of the rows whose number changes', () => {
  const rows = [{ id: 'a', lessonNo: 1 }, { id: 'b', lessonNo: 2 }, { id: 'c', lessonNo: 3 }];
  it('moves one place up or down; refuses the edges and a stranger', () => {
    expect(planMove(rows, 'b', 'up')).toEqual({ ok: true, steps: [{ id: 'b', from: 2, to: 1 }, { id: 'a', from: 1, to: 2 }], order: ['b', 'a', 'c'] });
    expect(planMove(rows, 'b', 'down')).toEqual({ ok: true, steps: [{ id: 'c', from: 3, to: 2 }, { id: 'b', from: 2, to: 3 }], order: ['a', 'c', 'b'] });
    expect(planMove(rows, 'a', 'up')).toEqual({ ok: false, refusal: 'AT_TOP' });
    expect(planMove(rows, 'c', 'down')).toEqual({ ok: false, refusal: 'AT_BOTTOM' });
    expect(planMove(rows, 'z', 'up')).toEqual({ ok: false, refusal: 'LESSON_NOT_IN_MODULE' });
    expect(planMove([{ id: 'only', lessonNo: 4 }], 'only', 'down')).toEqual({ ok: false, refusal: 'AT_BOTTOM' });
  });
  it('renumbers a gapped module to 1..n as a side effect, and touches only the rows that change', () => {
    const gapped = [{ id: 'a', lessonNo: 1 }, { id: 'b', lessonNo: 2 }, { id: 'c', lessonNo: 5 }];
    expect(renumber(gapped, ['a', 'b', 'c'])).toEqual([{ id: 'c', from: 5, to: 3 }]);
    expect(planMove(gapped, 'c', 'up')).toEqual({ ok: true, steps: [{ id: 'c', from: 5, to: 2 }, { id: 'b', from: 2, to: 3 }], order: ['a', 'c', 'b'] });
    expect(renumber(rows, ['a', 'b', 'c'])).toEqual([]);
    expect(renumber(rows, ['a', 'b', 'c', 'ghost'])).toEqual([]);   // an id not in the module is not a row to renumber
    // the plan's targets are a permutation: no two rows take the same number
    const p = planMove(gapped, 'a', 'down'); if (!p.ok) throw new Error('plan'); expect(new Set(p.steps.map((s) => s.to)).size).toBe(p.steps.length);
  });
  it('position is the 1-based place in the module\'s order, not the stored number', () => {
    expect(positionOf([{ id: 'a', lessonNo: 1 }, { id: 'c', lessonNo: 5 }], 'c')).toBe(2);
    expect(positionOf(rows, 'zz')).toBeNull();
    expect(positionOf([{ id: 'b', lessonNo: 2 }, { id: 'a', lessonNo: 1 }], 'a')).toBe(1);   // sorted, not as given
  });
});

describe('PC-56 TENANT-7b · the lesson acts — verdicts in the order a person wants to hear them', () => {
  const base: Omit<LessonActInput, 'act' | 'reason'> = { canAuthor: true, canPublish: false, isOwner: true, courseStatus: 'draft', lessonStatus: 'draft', hollow: false, mediaScanStatus: 'clean', quizExplained: true, quizThresholdSet: true, position: 2, moduleSize: 3 };
  const V = (act: LessonActInput['act'], o: Partial<LessonActInput> = {}) => lessonActVerdict({ ...base, act, reason: 'checked it twice', ...o });
  it('the state machine: draft ↔ ready and nothing else', () => {
    expect(canLessonTransition('draft', 'ready')).toBe(true); expect(canLessonTransition('ready', 'draft')).toBe(true);
    expect(canLessonTransition('draft', 'draft')).toBe(false); expect(canLessonTransition('ready', 'ready')).toBe(false);
    expect(isLessonStatus('ready')).toBe(true); expect(isLessonStatus('published')).toBe(false);
    expect(isLessonAct('ready')).toBe(true); expect(isLessonAct('delete')).toBe(false); expect(LESSON_ACTS).toEqual(['ready', 'reopen', 'move_up', 'move_down']);
  });
  it('ready: allowed when nothing is missing; refused by name for each gap, and by stage', () => {
    expect(V('ready')).toEqual({ act: 'ready', allowed: true, refusals: [], to: 'ready' });
    expect(V('ready', { hollow: true }).refusals).toEqual(['HOLLOW']);
    expect(V('ready', { mediaScanStatus: 'pending' }).refusals).toEqual(['MEDIA_NOT_CLEAN']);
    expect(V('ready', { mediaScanStatus: 'infected' }).refusals).toEqual(['MEDIA_NOT_CLEAN']);
    expect(V('ready', { mediaScanStatus: null }).refusals).toEqual([]);   // an article has no file to scan
    expect(V('ready', { quizExplained: false }).refusals).toEqual(['QUIZ_EXPLANATIONS_MISSING']);
    expect(V('ready', { quizThresholdSet: false }).refusals).toEqual(['QUIZ_THRESHOLD_MISSING']);
    expect(V('ready', { lessonStatus: 'ready' }).refusals).toEqual(['ILLEGAL_FROM_STATUS']);
    expect(V('ready', { hollow: true, quizExplained: false, quizThresholdSet: false, reason: '' }).refusals).toEqual(['HOLLOW', 'QUIZ_EXPLANATIONS_MISSING', 'QUIZ_THRESHOLD_MISSING', 'REASON_REQUIRED']);
  });
  it('reopen: only from ready; the moves: only inside the module', () => {
    expect(V('reopen').refusals).toEqual(['ILLEGAL_FROM_STATUS']);
    expect(V('reopen', { lessonStatus: 'ready' })).toEqual({ act: 'reopen', allowed: true, refusals: [], to: 'draft' });
    expect(V('move_up')).toMatchObject({ allowed: true, to: null }); expect(V('move_down')).toMatchObject({ allowed: true, to: null });
    expect(V('move_up', { position: 1 }).refusals).toEqual(['AT_TOP']); expect(V('move_down', { position: 3 }).refusals).toEqual(['AT_BOTTOM']);
    expect(V('move_down', { position: 1, moduleSize: 1 }).refusals).toEqual(['AT_BOTTOM']);
    // a move does not care whether the lesson is ready or hollow
    expect(V('move_up', { lessonStatus: 'ready', hollow: true, mediaScanStatus: 'failed' }).allowed).toBe(true);
  });
  it('permission → owner → the course\'s stage → reason, before anything about the lesson', () => {
    expect(V('ready', { canAuthor: false }).refusals).toEqual(['NO_PERMISSION', 'NOT_OWNER'].filter((x) => x !== 'NOT_OWNER'));
    expect(V('ready', { canAuthor: false, isOwner: false }).refusals).toEqual(['NO_PERMISSION', 'NOT_OWNER']);
    expect(V('ready', { isOwner: false }).refusals).toEqual(['NOT_OWNER']);
    expect(V('ready', { isOwner: false, canPublish: true }).allowed).toBe(true);   // the desk may mark any lesson of the tenant ready
    expect(V('ready', { courseStatus: 'archived' }).refusals).toEqual(['COURSE_ARCHIVED']);
    expect(V('ready', { reason: 'ok' }).refusals).toEqual(['REASON_REQUIRED']); expect(V('ready', { reason: 'x'.repeat(301) }).refusals).toEqual(['REASON_REQUIRED']);
    expect(V('ready', { reason: 'abc' }).allowed).toBe(true);
    const all = allLessonVerdicts(base);
    expect(all.map((a) => a.act)).toEqual([...LESSON_ACTS]);
    for (const a of all) { expect(a.refusals).not.toContain('REASON_REQUIRED'); for (const r of a.refusals) expect(LESSON_ACT_REFUSALS).toContain(r); }
    expect(all.find((a) => a.act === 'reopen')?.allowed).toBe(false);
  });
});

describe('PC-56 TENANT-7b · the lesson form — a decision, not an echo', () => {
  const media = { id: 'm-video', kind: 'video', scanStatus: 'clean', mimeType: 'video/mp4', bytes: '1', durationSecs: null };
  const audioSib = { id: 'l-audio', contentKind: 'audio' as const, defaultTitle: 'Colostrum (audio-only)', pairedWith: null };
  const I = (entered: LessonReviewInput['entered'], o: Partial<LessonReviewInput> = {}): LessonReviewInput => ({ canAuthor: true, canPublish: false, isOwner: true, course: { status: 'draft' }, nextLessonNo: 4, entered, media: undefined, sibling: undefined, ...o });
  const VIDEO = { defaultTitle: ' Colostrum & calf feeding ', contentKind: 'video', mediaId: 'm-video', duration: '6:45', siblingLessonId: 'l-audio', thumbnailAt: '2:31', chapters: '00:00 Why colostrum\n02:14 How much' };
  it('the fields are the canon\'s and the position is shown though never typed; every refusal has a row', () => {
    const r = reviewLesson(I(VIDEO, { media, sibling: audioSib }));
    expect(r.ready).toBe(true); expect(r.refusals).toEqual([]); expect(r.diff).toBeNull();
    expect(r.fields.map((f) => f.name)).toEqual(['position', ...LESSON_FORM_FIELDS]);
    expect(r.fields.find((f) => f.name === 'position')).toEqual({ name: 'position', entered: null, stored: '1·4', normalised: true });
    expect(r.fields.find((f) => f.name === 'defaultTitle')).toEqual({ name: 'defaultTitle', entered: 'Colostrum & calf feeding', stored: 'Colostrum & calf feeding', normalised: false });
    expect(r.fields.find((f) => f.name === 'duration')).toEqual({ name: 'duration', entered: '6:45', stored: '06:45', normalised: true });
    expect(r.fields.find((f) => f.name === 'thumbnailAt')?.stored).toBe('02:31');
    expect(r.fields.find((f) => f.name === 'mediaId')?.stored).toBe('m-video · video · clean');
    expect(r.fields.find((f) => f.name === 'siblingLessonId')?.stored).toBe('l-audio · Colostrum (audio-only)');
    expect(r.fields.find((f) => f.name === 'chapters')?.stored).toBe('00:00 — Why colostrum\n02:14 — How much');
    const s = storedLesson(I(VIDEO, { media, sibling: audioSib }));
    expect(s).toEqual({ moduleNo: 1, lessonNo: 4, defaultTitle: 'Colostrum & calf feeding', contentKind: 'video', mediaId: 'm-video', body: null, durationSecs: 405, siblingLessonId: 'l-audio', thumbnailFrameSecs: 151, chapters: [{ at: 0, title: 'Why colostrum' }, { at: 134, title: 'How much' }] });
    expect(storedLesson(I({ ...VIDEO, moduleNo: '2' }, { media, sibling: audioSib, nextLessonNo: 1 }))?.moduleNo).toBe(2);
  });
  it('media: required for video/pdf/audio, of the right kind, in THIS tenant\'s bucket, none on an article or a quiz', () => {
    expect(reviewLesson(I({ ...VIDEO, mediaId: '' }, { sibling: audioSib })).refusals).toEqual([{ field: 'mediaId', code: 'MEDIA_REQUIRED' }]);
    expect(reviewLesson(I(VIDEO, { media: null, sibling: audioSib })).refusals).toEqual([{ field: 'mediaId', code: 'MEDIA_UNKNOWN' }]);
    expect(reviewLesson(I(VIDEO, { media: { ...media, kind: 'audio' }, sibling: audioSib })).refusals).toEqual([{ field: 'mediaId', code: 'MEDIA_KIND_MISMATCH' }]);
    expect(reviewLesson(I({ defaultTitle: 'Feed label', contentKind: 'pdf', mediaId: 'm' }, { media: { ...media, kind: 'document' } })).ready).toBe(true);
    expect(reviewLesson(I({ defaultTitle: 'Ration', contentKind: 'article', body: 'text', mediaId: 'm' }, { media })).refusals).toEqual([{ field: 'mediaId', code: 'MEDIA_NOT_FOR_KIND' }]);
    expect(reviewLesson(I({ defaultTitle: 'Ration', contentKind: 'article' })).refusals).toEqual([{ field: 'body', code: 'BODY_REQUIRED' }]);
    expect(reviewLesson(I({ defaultTitle: 'Quick check', contentKind: 'quiz' })).ready).toBe(true);   // the questions come through the quiz chain
    expect(reviewLesson(I({ defaultTitle: 'Q&A', contentKind: 'live' })).ready).toBe(true);           // a recording may follow
    expect(reviewLesson(I({ defaultTitle: 'Q&A', contentKind: 'live', mediaId: 'm' }, { media: { ...media, kind: 'audio' } })).ready).toBe(true);
    // a scan not yet clean is shown, not refused — `ready` is where it blocks
    expect(reviewLesson(I(VIDEO, { media: { ...media, scanStatus: 'pending' }, sibling: audioSib })).fields.find((f) => f.name === 'mediaId')?.stored).toBe('m-video · video · pending');
  });
  it('duration: required for video/audio, a clock or seconds; the thumbnail and the chapters fall inside it', () => {
    expect(reviewLesson(I({ ...VIDEO, duration: '' }, { media, sibling: audioSib })).refusals).toEqual([{ field: 'duration', code: 'DURATION_REQUIRED' }]);
    expect(reviewLesson(I({ ...VIDEO, duration: '6:75' }, { media, sibling: audioSib })).refusals).toEqual([{ field: 'duration', code: 'DURATION_INVALID' }]);
    expect(reviewLesson(I({ ...VIDEO, thumbnailAt: '7:00' }, { media, sibling: audioSib })).refusals).toEqual([{ field: 'thumbnailAt', code: 'THUMBNAIL_BEYOND_DURATION' }]);
    expect(reviewLesson(I({ ...VIDEO, thumbnailAt: 'x' }, { media, sibling: audioSib })).refusals).toEqual([{ field: 'thumbnailAt', code: 'THUMBNAIL_INVALID' }]);
    expect(reviewLesson(I({ ...VIDEO, chapters: '09:00 late' }, { media, sibling: audioSib })).refusals).toEqual([{ field: 'chapters', code: 'CHAPTER_BEYOND_DURATION' }]);
    expect(reviewLesson(I({ defaultTitle: 'Feed label', contentKind: 'pdf', mediaId: 'm', duration: '' }, { media: { ...media, kind: 'document' } })).ready).toBe(true);
    expect(reviewLesson(I({ defaultTitle: 'Feed label', contentKind: 'pdf', mediaId: 'm', thumbnailAt: '0:10' }, { media: { ...media, kind: 'document' } })).refusals).toEqual([{ field: 'thumbnailAt', code: 'THUMBNAIL_NOT_FOR_KIND' }]);
    expect(reviewLesson(I({ defaultTitle: 'Ration', contentKind: 'article', body: 't', chapters: '00:00 a' })).refusals).toEqual([{ field: 'chapters', code: 'CHAPTERS_NOT_FOR_KIND' }]);
    expect(reviewLesson(I({ defaultTitle: 'Talk', contentKind: 'audio', mediaId: 'm', duration: '500', chapters: '00:00 a\n01:00 b' }, { media: { ...media, kind: 'audio' } })).fields.find((f) => f.name === 'duration')?.stored).toBe('08:20');
  });
  it('the audio twin: a video\'s only, an audio lesson of this course, not itself, not already paired', () => {
    expect(reviewLesson(I(VIDEO, { media, sibling: null })).refusals).toEqual([{ field: 'siblingLessonId', code: 'SIBLING_UNKNOWN' }]);
    expect(reviewLesson(I(VIDEO, { media, sibling: { ...audioSib, contentKind: 'video' } })).refusals).toEqual([{ field: 'siblingLessonId', code: 'SIBLING_NOT_AUDIO' }]);
    expect(reviewLesson(I(VIDEO, { media, sibling: { ...audioSib, pairedWith: 'another-video' } })).refusals).toEqual([{ field: 'siblingLessonId', code: 'SIBLING_TAKEN' }]);
    expect(reviewLesson(I({ defaultTitle: 'Talk', contentKind: 'audio', mediaId: 'm', duration: '1:00', siblingLessonId: 'l-audio' }, { media: { ...media, kind: 'audio' }, sibling: audioSib })).refusals).toEqual([{ field: 'siblingLessonId', code: 'SIBLING_NOT_FOR_KIND' }]);
    // on an edit: the twin may stay paired with THIS lesson, and a lesson is never its own twin
    const cur = { id: 'l-video', status: 'draft', moduleNo: 1, lessonNo: 3, defaultTitle: 'Colostrum & calf feeding', contentKind: 'video' as const, mediaId: 'm-video', body: null, durationSecs: 405, siblingLessonId: 'l-audio', thumbnailFrameSecs: 151, chapters: [{ at: 0, title: 'Why colostrum' }, { at: 134, title: 'How much' }] };
    expect(reviewLesson(I(VIDEO, { media, sibling: { ...audioSib, pairedWith: 'l-video' }, current: cur })).ready).toBe(true);
    expect(reviewLesson(I({ ...VIDEO, siblingLessonId: 'l-video' }, { media, sibling: audioSib, current: cur })).refusals).toEqual([{ field: 'siblingLessonId', code: 'SIBLING_IS_SELF' }]);
    expect(reviewLesson(I({ ...VIDEO, siblingLessonId: '' }, { media })).ready).toBe(true);   // unpaired is allowed here; the GATE says so, by name
  });
  it('an EDIT keeps its position, diffs changed rows only, and is refused while the lesson is ready', () => {
    const cur = { id: 'l-video', status: 'draft', moduleNo: 1, lessonNo: 3, defaultTitle: 'Colostrum & calf feeding', contentKind: 'video' as const, mediaId: 'm-video', body: null, durationSecs: 405, siblingLessonId: 'l-audio', thumbnailFrameSecs: 151, chapters: [{ at: 0, title: 'Why colostrum' }, { at: 134, title: 'How much' }] };
    const same = reviewLesson(I(VIDEO, { media, sibling: { ...audioSib, pairedWith: 'l-video' }, current: cur, nextLessonNo: 99 }));
    expect(same.diff).toEqual([]); expect(same.fields.find((f) => f.name === 'position')?.stored).toBe('1·3');
    const changed = reviewLesson(I({ ...VIDEO, duration: '7:00', chapters: '00:00 Why colostrum' }, { media, sibling: { ...audioSib, pairedWith: 'l-video' }, current: cur }));
    expect(changed.diff).toEqual([{ field: 'duration', before: '06:45', after: '07:00' }, { field: 'chapters', before: '00:00 — Why colostrum\n02:14 — How much', after: '00:00 — Why colostrum' }]);
    expect(storedLesson(I({ ...VIDEO, moduleNo: '7' }, { media, sibling: { ...audioSib, pairedWith: 'l-video' }, current: cur }))).toMatchObject({ moduleNo: 1, lessonNo: 3 });
    expect(reviewLesson(I(VIDEO, { media, sibling: audioSib, current: { ...cur, status: 'ready' } })).refusals).toEqual([{ field: null, code: 'LESSON_READY' }]);
    expect(reviewLesson(I(VIDEO, { media, sibling: audioSib, current: null })).refusals).toEqual([{ field: null, code: 'LESSON_NOT_FOUND' }]);
    expect(lessonFormValues(cur)).toEqual({ moduleNo: '1', defaultTitle: 'Colostrum & calf feeding', contentKind: 'video', mediaId: 'm-video', body: '', duration: '06:45', siblingLessonId: 'l-audio', thumbnailAt: '02:31', chapters: '00:00 — Why colostrum\n02:14 — How much' });
  });
  it('permission, ownership, the course, the title, the kind, the module; every refusal is printable', () => {
    expect(reviewLesson(I(VIDEO, { media, sibling: audioSib, canAuthor: false })).refusals).toEqual([{ field: null, code: 'NO_AUTHOR' }]);
    expect(reviewLesson(I(VIDEO, { media, sibling: audioSib, isOwner: false })).refusals).toEqual([{ field: null, code: 'NOT_OWNER' }]);
    expect(reviewLesson(I(VIDEO, { media, sibling: audioSib, isOwner: false, canPublish: true })).ready).toBe(true);
    expect(reviewLesson(I(VIDEO, { media, sibling: audioSib, course: null })).refusals).toEqual([{ field: null, code: 'COURSE_NOT_FOUND' }]);
    expect(reviewLesson(I(VIDEO, { media, sibling: audioSib, course: { status: 'archived' } })).refusals).toEqual([{ field: null, code: 'COURSE_ARCHIVED' }]);
    expect(reviewLesson(I({ ...VIDEO, defaultTitle: '  ' }, { media, sibling: audioSib })).refusals).toEqual([{ field: 'defaultTitle', code: 'TITLE_REQUIRED' }]);
    expect(reviewLesson(I({ ...VIDEO, contentKind: 'podcast' }, { media, sibling: audioSib })).refusals.map((r) => r.code)).toContain('KIND_INVALID');
    expect(reviewLesson(I({ ...VIDEO, moduleNo: '0' }, { media, sibling: audioSib })).refusals).toEqual([{ field: 'moduleNo', code: 'MODULE_INVALID' }]);
    expect(reviewLesson(I(VIDEO, { media, sibling: audioSib, writerIssues: [{ path: 'defaultTitle', tooLong: true }] })).refusals).toEqual([{ field: 'defaultTitle', code: 'TOO_LONG' }]);
    for (const code of LESSON_REVIEW_REFUSALS) expect(typeof code).toBe('string');
    expect(storedLesson(I({ ...VIDEO, defaultTitle: '' }, { media, sibling: audioSib }))).toBeNull();
  });
  it('the subtitle track: one language of the tenant\'s, a body, a human\'s review mark; only on a lesson that carries speech', () => {
    const S = (entered: SubtitleReviewInput['entered'], o: Partial<SubtitleReviewInput> = {}) => reviewSubtitle({ canAuthor: true, canPublish: false, isOwner: true, lesson: { contentKind: 'video', status: 'draft', courseStatus: 'draft' }, languages: ['hi', 'en', 'gu'], current: undefined, entered, ...o });
    const ok = S({ languageCode: 'gu', body: 'WEBVTT\n\n00:00.000 --> 00:04.000\nનમસ્તે', reviewed: '1' });
    expect(ok.ready).toBe(true); expect(ok.fields.map((f) => f.name)).toEqual(['languageCode', 'body', 'reviewed']);
    expect(ok.fields.find((f) => f.name === 'reviewed')?.stored).toBe('reviewed'); expect(ok.diff).toBeNull();
    expect(storedSubtitle({ canAuthor: true, canPublish: false, isOwner: true, lesson: { contentKind: 'video', status: 'draft', courseStatus: 'draft' }, languages: ['gu'], current: undefined, entered: { languageCode: 'gu', body: ' x ', reviewed: '' } })).toEqual({ languageCode: 'gu', body: 'x', reviewed: false });
    expect(S({ languageCode: 'ta', body: 'x' }).refusals).toEqual([{ field: 'languageCode', code: 'LANGUAGE_UNKNOWN' }]);
    expect(S({ body: 'x' }).refusals).toEqual([{ field: 'languageCode', code: 'LANGUAGE_REQUIRED' }]);
    expect(S({ languageCode: 'hi' }).refusals).toEqual([{ field: 'body', code: 'BODY_REQUIRED' }]);
    expect(S({ languageCode: 'hi', body: 'x' }, { lesson: { contentKind: 'article', status: 'draft', courseStatus: 'draft' } }).refusals).toEqual([{ field: null, code: 'KIND_HAS_NO_SPEECH' }]);
    expect(S({ languageCode: 'hi', body: 'x' }, { lesson: { contentKind: 'video', status: 'ready', courseStatus: 'draft' } }).refusals).toEqual([{ field: null, code: 'LESSON_READY' }]);
    expect(S({ languageCode: 'hi', body: 'x' }, { lesson: { contentKind: 'video', status: 'draft', courseStatus: 'archived' } }).refusals).toEqual([{ field: null, code: 'COURSE_ARCHIVED' }]);
    expect(S({ languageCode: 'hi', body: 'x' }, { lesson: null }).refusals).toEqual([{ field: null, code: 'LESSON_NOT_FOUND' }]);
    expect(S({ languageCode: 'hi', body: 'x' }, { canAuthor: false, isOwner: false }).refusals).toEqual([{ field: null, code: 'NO_AUTHOR' }, { field: null, code: 'NOT_OWNER' }]);
    // the diff: a replaced body shows as sizes, a review mark as the status change
    expect(S({ languageCode: 'hi', body: 'longer text', reviewed: '1' }, { current: { body: 'short', status: 'draft' } }).diff).toEqual([{ field: 'body', before: '5', after: '11' }, { field: 'reviewed', before: 'draft', after: 'reviewed' }]);
    expect(S({ languageCode: 'hi', body: 'short' }, { current: { body: 'short', status: 'draft' } }).diff).toEqual([]);
    for (const code of SUBTITLE_REVIEW_REFUSALS) expect(typeof code).toBe('string');
    expect(storedSubtitle({ canAuthor: true, canPublish: false, isOwner: true, lesson: null, languages: ['gu'], current: undefined, entered: { languageCode: 'gu', body: 'x' } })).toBeNull();
  });
});

describe('PC-56 TENANT-7b · W416\'s six checks, measured on the lesson record', () => {
  const L = (o: Partial<GateLesson>): GateLesson => ({ id: `id-${o.moduleNo ?? 1}-${o.lessonNo ?? 1}`, moduleNo: 1, lessonNo: 1, defaultTitle: 'x', contentKind: 'video', mediaId: 'm', body: null, quiz: null, status: 'ready', siblingLessonId: 'sib', thumbnailFrameSecs: 10, durationSecs: 500, quizPassingPct: null, ...o });
  const subs = (m: Record<string, string[]>) => new Map(Object.entries(m).map(([k, v]) => [k, new Set(v)]));
  const G = (lessons: GateLesson[], reviewed: ReadonlyMap<string, ReadonlySet<string>> = new Map(), languages = ['hi', 'en', 'gu']) => computeGate({ lessons, reviewedSubtitles: reviewed, languages, topicCode: 'crop_care', priceMinor: '0', currencyCode: 'INR', certEnabled: true, hasInstructor: true });
  const Q = { questions: [{ q: 'a', options: ['x', 'y'], answer: 0, explanations: ['right', 'wrong'] }] };
  it('a paired, framed, subtitled, ready video passes every check', () => {
    const v = L({ lessonNo: 1 }); const a = L({ lessonNo: 2, id: 'sib', contentKind: 'audio', siblingLessonId: null, thumbnailFrameSecs: null });
    const g = G([v, a], subs({ 'id-1-1': ['hi', 'en', 'gu'], sib: ['hi', 'en', 'gu'] }));
    expect(g.ready).toBe(true); expect(g.blocking).toEqual([]);
    expect(g.checks.find((c) => c.code === 'AUDIO_SIBLINGS')?.measured).toEqual({ met: 1, of: 1 });
    expect(g.checks.filter((c) => c.code === 'SUBTITLES').map((c) => [c.lang, c.measured?.met, c.measured?.of])).toEqual([['hi', 2, 2], ['en', 2, 2], ['gu', 2, 2]]);
    expect(g.checks.find((c) => c.code === 'THUMBNAILS_REAL')?.measured).toEqual({ met: 1, of: 1 });
    expect(g.checks.find((c) => c.code === 'LESSONS_READY')?.measured).toEqual({ met: 2, of: 2 });
  });
  it('AUDIO_SIBLINGS names the unpaired video; LESSONS_READY names the draft; both block', () => {
    const g = G([L({ lessonNo: 1, siblingLessonId: null, defaultTitle: 'Mineral mixes explained' }), L({ lessonNo: 2, status: 'draft', defaultTitle: 'Dry period' })], subs({ 'id-1-1': ['hi', 'en', 'gu'], 'id-1-2': ['hi', 'en', 'gu'] }));
    expect(g.blocking).toEqual(['LESSONS_READY', 'AUDIO_SIBLINGS']);
    expect(g.checks.find((c) => c.code === 'AUDIO_SIBLINGS')).toMatchObject({ state: 'fail', measured: { met: 1, of: 2 }, named: ['1·1 Mineral mixes explained'] });
    expect(g.checks.find((c) => c.code === 'LESSONS_READY')).toMatchObject({ state: 'fail', measured: { met: 1, of: 2 }, named: ['1·2 Dry period'] });
  });
  it('SUBTITLES: one check per tenant language, a DRAFT track does not count, non-speech lessons are not asked (W416: "en 10/12 — two lessons named")', () => {
    const rows = [L({ lessonNo: 1, defaultTitle: 'Welcome' }), L({ lessonNo: 2, contentKind: 'audio', siblingLessonId: null, thumbnailFrameSecs: null, defaultTitle: 'Welcome (audio-only)' }), L({ lessonNo: 3, contentKind: 'pdf', siblingLessonId: null, thumbnailFrameSecs: null, defaultTitle: 'Feed label' })];
    const g = G(rows, subs({ 'id-1-1': ['gu', 'hi'], 'id-1-2': ['gu', 'hi', 'en'] }), ['gu', 'hi', 'en']);
    const en = g.checks.find((c) => c.code === 'SUBTITLES' && c.lang === 'en')!;
    expect(en).toMatchObject({ state: 'fail', measured: { met: 1, of: 2 }, named: ['1·1 Welcome'] });
    expect(g.checks.find((c) => c.code === 'SUBTITLES' && c.lang === 'gu')).toMatchObject({ state: 'pass', measured: { met: 2, of: 2 } });
    expect(g.blocking).toEqual(['SUBTITLES']);   // one code, though the check appears once per language
    expect(G(rows, subs({ 'id-1-2': ['gu'] }), ['gu', 'hi', 'en']).blocking).toEqual(['SUBTITLES']);   // three failing languages, the code listed ONCE
    expect(G(rows, new Map(), []).checks.filter((c) => c.code === 'SUBTITLES')).toEqual([]);   // a tenant with no language declares no subtitle check
  });
  it('QUIZ_EXPLANATIONS and QUIZ_THRESHOLD name the quiz; a quiz with every option explained and a threshold passes', () => {
    const bare = L({ lessonNo: 1, contentKind: 'quiz', mediaId: null, siblingLessonId: null, thumbnailFrameSecs: null, quiz: { questions: [{ q: 'a', options: ['x', 'y'], answer: 0, hint: 'h' }] }, defaultTitle: 'Quick check' });
    const g = G([bare]);
    expect(g.blocking).toEqual(['QUIZ_EXPLANATIONS', 'QUIZ_THRESHOLD']);
    expect(g.checks.find((c) => c.code === 'QUIZ_EXPLANATIONS')).toMatchObject({ measured: { met: 0, of: 1 }, named: ['1·1 Quick check'] });
    expect(g.checks.find((c) => c.code === 'QUIZ_THRESHOLD')).toMatchObject({ measured: { met: 0, of: 1 }, named: ['1·1 Quick check'] });
    expect(G([{ ...bare, quiz: Q, quizPassingPct: 70 }]).ready).toBe(true);
    expect(G([{ ...bare, quiz: Q, quizPassingPct: 0 }]).blocking).toEqual([]);   // 0 is a declared threshold, not a missing one
    expect(G([{ ...bare, quiz: { questions: [{ q: 'a', options: ['x', 'y'], answer: 0, explanations: ['right', ' '] }] }, quizPassingPct: 70 }]).blocking).toEqual(['QUIZ_EXPLANATIONS']);
  });
  it('THUMBNAILS_REAL: a declared frame inside the lesson; beyond the duration or absent fails', () => {
    expect(thumbnailDeclared({ thumbnailFrameSecs: 10, durationSecs: 500 })).toBe(true);
    expect(thumbnailDeclared({ thumbnailFrameSecs: 500, durationSecs: 500 })).toBe(false);
    expect(thumbnailDeclared({ thumbnailFrameSecs: null, durationSecs: 500 })).toBe(false);
    expect(thumbnailDeclared({ thumbnailFrameSecs: 10, durationSecs: null })).toBe(true);
    const g = G([L({ lessonNo: 1, thumbnailFrameSecs: null, defaultTitle: 'No frame' })], subs({ 'id-1-1': ['hi', 'en', 'gu'] }));
    expect(g.blocking).toEqual(['THUMBNAILS_REAL']);
    expect(g.checks.find((c) => c.code === 'THUMBNAILS_REAL')).toMatchObject({ measured: { met: 0, of: 1 }, named: ['1·1 No frame'] });
    // an audio lesson has no frame to declare and is not counted
    expect(G([L({ lessonNo: 1, contentKind: 'audio', siblingLessonId: null, thumbnailFrameSecs: null })], subs({ 'id-1-1': ['hi', 'en', 'gu'] })).checks.find((c) => c.code === 'THUMBNAILS_REAL')?.measured).toEqual({ met: 0, of: 0 });
  });
  it('the entity: born draft, ready with an actor and an instant, reopened clean, not edited while ready', () => {
    const l = CourseLesson.create({ id: 'l', courseId: 'c', moduleNo: 1, lessonNo: 1, defaultTitle: 't', contentKind: 'article', mediaId: null, body: 'b', durationSecs: null, quiz: null, siblingLessonId: null, thumbnailFrameSecs: null, chapters: [], quizPassingPct: null });
    expect(l.status).toBe('draft'); expect(l.toJSON()).toMatchObject({ readyAt: null, readyBy: null });
    const at = new Date('2026-09-16T10:00:00Z'); l.markReady('u1', at);
    expect(l.toJSON()).toMatchObject({ status: 'ready', readyAt: at, readyBy: 'u1' });
    expect(() => l.markReady('u1', at)).toThrow(); expect(() => l.updateContent({ defaultTitle: 't2', contentKind: 'article', mediaId: null, body: 'b', durationSecs: null, siblingLessonId: null, thumbnailFrameSecs: null, chapters: [] })).toThrow();
    l.reopen(); expect(l.toJSON()).toMatchObject({ status: 'draft', readyAt: null, readyBy: null });
    expect(() => l.reopen()).toThrow();
    l.updateContent({ defaultTitle: 't2', contentKind: 'article', mediaId: null, body: 'b', durationSecs: null, siblingLessonId: null, thumbnailFrameSecs: null, chapters: [{ at: 1, title: 'c' }] });
    expect(l.toJSON()).toMatchObject({ defaultTitle: 't2', chapters: [{ at: 1, title: 'c' }] });
    l.setQuiz(Q, 70); expect(l.toJSON()).toMatchObject({ quiz: Q, quizPassingPct: 70 });
    expect(() => CourseLesson.create({ id: 'l', courseId: 'c', moduleNo: 1, lessonNo: 0, defaultTitle: 't', contentKind: 'article', mediaId: null, body: 'b', durationSecs: null, quiz: null, siblingLessonId: null, thumbnailFrameSecs: null, chapters: [], quizPassingPct: null })).toThrow();
  });
});
