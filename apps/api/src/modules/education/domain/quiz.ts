// modules/education/domain/quiz.ts · PC-56 TENANT-7b · the quiz as a thing the platform can measure — W413 (quiz
// builder) and the quiz-form chain (W2727–W2730).
//
// W413: *"A quiz that locks content is a wall; ours is a mirror. Passing threshold gates the certificate only — never
// the next lesson. Unlimited retries. No negative marking."* · *"Options — each needs an explanation (mandatory)"* ·
// *"Save is disabled until every option teaches something, right or wrong."*
//
// THE SHAPE. PC-26b's canonical quiz JSON is `{questions:[{q, options, answer, hint?}]}` — the shape the mobile learner
// parser (`apps/mobile … learn.ts parseQuiz`) consumes and tolerates extra keys on. This file adds `explanations:
// string[]` aligned with `options` (one sentence per option, shown on a wrong answer with a link back to the lesson),
// and keeps `answer` as a 0-based index. The threshold is NOT in the JSON: it is a column (`quiz_passing_pct`, 0171)
// with a CHECK, so the gate and the scorer read one integer and not a document.
//
// THE MATHS. Integer arithmetic only. A learner passes when `correct × 100 ≥ passingPct × total` — no float, no
// rounding on the boundary, and `neededCorrect` is the ceiling the header prints (*"Pass: N/total"*). The mobile app
// carries `QUIZ_PASS_PCT = 60` as a constant (Law 6 says that belongs in a row); the row exists now and the SDK carries
// it on the lesson — moving the mobile scorer onto it is named in the report, not done by this wave.
export interface QuizQuestion { q: string; options: string[]; answer: number; explanations: string[] }
export interface QuizDoc { questions: QuizQuestion[] }

export const MIN_OPTIONS = 2;      // the learner parser's own rule since PC-26: one option is not a question anybody can get wrong
export const MAX_OPTIONS = 6;      // the form's rows — W413 draws three; six is the ceiling a no-JS form can carry
export const MAX_QUESTIONS = 50;
export const MAX_QUESTION_TEXT = 500;
export const MAX_OPTION_TEXT = 200;
export const MAX_EXPLANATION_TEXT = 500;

/** The stored JSON as questions — the learner parser's rules, with explanations read leniently (absent = []). */
export function readQuiz(raw: unknown): QuizDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const qs = (raw as { questions?: unknown }).questions;
  if (!Array.isArray(qs)) return null;
  const out: QuizQuestion[] = [];
  for (const item of qs) {
    if (!item || typeof item !== 'object') return null;
    const { q, options, answer, explanations } = item as Record<string, unknown>;
    if (typeof q !== 'string' || !Array.isArray(options) || !options.every((o) => typeof o === 'string')) return null;
    if (!Number.isInteger(answer)) return null;
    const ex = Array.isArray(explanations) ? explanations.map((e) => (typeof e === 'string' ? e : '')) : [];
    out.push({ q, options: options as string[], answer: answer as number, explanations: ex });
  }
  return { questions: out };
}

/** Well-formed by the learner's rules: ≥ 2 options and an answer among them, for EVERY question, and at least one. */
export function quizWellFormed(doc: QuizDoc | null): boolean {
  if (!doc || doc.questions.length === 0) return false;
  return doc.questions.every((x) => x.options.length >= MIN_OPTIONS && x.answer >= 0 && x.answer < x.options.length);
}

/** W413's rule: every option of every question carries a non-empty explanation. The positions that do not, 1-based. */
export function missingExplanations(doc: QuizDoc | null): Array<{ question: number; option: number }> {
  if (!doc) return [];
  const out: Array<{ question: number; option: number }> = [];
  doc.questions.forEach((x, qi) => x.options.forEach((_, oi) => {
    if ((x.explanations[oi] ?? '').trim().length === 0) out.push({ question: qi + 1, option: oi + 1 });
  }));
  return out;
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE MATHS                                                                                                 */
/* --------------------------------------------------------------------------------------------------------- */

/** Correct answers needed to pass `total` questions at `passingPct` — ceil in integers. 0 questions need 0. */
export function neededCorrect(total: number, passingPct: number): number {
  if (total <= 0) return 0;
  return Math.ceil((passingPct * total) / 100);
}
export interface QuizScore { correct: number; total: number; scorePct: number; passed: boolean }
/** Score one attempt. `answers[i]` is the chosen option index (or null/undefined = unanswered). No negative marking. */
export function scoreQuiz(doc: QuizDoc, answers: ReadonlyArray<number | null | undefined>, passingPct: number): QuizScore {
  const total = doc.questions.length;
  if (total === 0) return { correct: 0, total: 0, scorePct: 0, passed: false };
  let correct = 0;
  for (let i = 0; i < total; i++) if (answers[i] === doc.questions[i].answer) correct += 1;
  return { correct, total, scorePct: Math.floor((correct * 100) / total), passed: correct * 100 >= passingPct * total };
}

/** `70`, `70%`, ` 70 ` → 70. Null for anything that is not an integer 0–100. */
export function parsePassingPct(raw: string | null | undefined): number | null {
  const s = (raw ?? '').trim().replace(/\s*%$/, '');
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= 100 ? n : null;
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE QUESTION FORM (W2727–W2730) — review and write, one function                                          */
/* --------------------------------------------------------------------------------------------------------- */
import { ReviewDiffRow, ReviewField, ReviewRefusal, ReviewResult, WRITER_REFUSALS, WriterIssue, field, reviewResult, trimOrNull, writerRefusals } from '../../../shared/form-review';

export const QUESTION_REVIEW_REFUSALS = [
  'NO_AUTHOR', 'NOT_OWNER', 'COURSE_ARCHIVED', 'LESSON_NOT_FOUND', 'NOT_A_QUIZ', 'LESSON_READY', 'QUESTION_NOT_FOUND',
  'QUESTION_REQUIRED', 'OPTIONS_MIN', 'OPTION_GAP', 'ANSWER_REQUIRED', 'ANSWER_NOT_AN_OPTION', 'EXPLANATION_REQUIRED',
  'THRESHOLD_INVALID', 'THRESHOLD_REQUIRED', 'TOO_MANY_QUESTIONS',
  ...WRITER_REFUSALS,
] as const;
export type QuestionReviewRefusal = (typeof QUESTION_REVIEW_REFUSALS)[number];

/** The rows the chain carries. `optN`/`explN` for N in 1..MAX_OPTIONS; `answer` is the option NUMBER a person picks. */
export const QUESTION_FORM_FIELDS = [
  'q',
  ...Array.from({ length: MAX_OPTIONS }, (_, i) => `opt${i + 1}`),
  ...Array.from({ length: MAX_OPTIONS }, (_, i) => `expl${i + 1}`),
  'answer', 'passingPct',
] as const;
export type QuestionFormField = (typeof QUESTION_FORM_FIELDS)[number];

export interface QuestionReviewInput {
  canAuthor: boolean; canPublish: boolean; isOwner: boolean;
  /** The lesson as it stands: null = no such lesson of ours. */
  lesson: { contentKind: string; status: string; courseStatus: string; quiz: QuizDoc | null; passingPct: number | null } | null;
  /** 1-based question number the form addresses; `count + 1` is a new question. */
  questionNo: number;
  entered: Partial<Record<QuestionFormField, string | null | undefined>>;
  writerIssues?: readonly WriterIssue[];
}
export interface QuestionStored { doc: QuizDoc; passingPct: number; questionNo: number }

export function reviewQuestion(i: QuestionReviewInput): ReviewResult {
  const refusals: ReviewRefusal[] = [];
  if (!i.canAuthor && !i.canPublish) refusals.push({ field: null, code: 'NO_AUTHOR' });
  if (!i.isOwner && !i.canPublish) refusals.push({ field: null, code: 'NOT_OWNER' });
  const L = i.lesson;
  if (!L) refusals.push({ field: null, code: 'LESSON_NOT_FOUND' });
  else {
    if (L.courseStatus === 'archived') refusals.push({ field: null, code: 'COURSE_ARCHIVED' });
    if (L.contentKind !== 'quiz') refusals.push({ field: null, code: 'NOT_A_QUIZ' });
    if (L.status === 'ready') refusals.push({ field: null, code: 'LESSON_READY' });
  }
  const count = L?.quiz?.questions.length ?? 0;
  const isEdit = i.questionNo >= 1 && i.questionNo <= count;
  if (i.questionNo < 1 || i.questionNo > count + 1) refusals.push({ field: null, code: 'QUESTION_NOT_FOUND' });
  if (!isEdit && count >= MAX_QUESTIONS) refusals.push({ field: null, code: 'TOO_MANY_QUESTIONS' });

  const q = trimOrNull(i.entered.q);
  if (q === null) refusals.push({ field: 'q', code: 'QUESTION_REQUIRED' });

  // OPTIONS: contiguous from 1; a blank option with a filled one after it is a gap the person did not mean.
  const opts: Array<string | null> = []; const expls: Array<string | null> = [];
  for (let n = 1; n <= MAX_OPTIONS; n++) { opts.push(trimOrNull(i.entered[`opt${n}` as QuestionFormField])); expls.push(trimOrNull(i.entered[`expl${n}` as QuestionFormField])); }
  let lastFilled = -1;
  opts.forEach((o, idx) => { if (o !== null) lastFilled = idx; });
  const options: string[] = []; const explanations: string[] = [];
  for (let idx = 0; idx <= lastFilled; idx++) {
    if (opts[idx] === null) { refusals.push({ field: `opt${idx + 1}`, code: 'OPTION_GAP' }); continue; }
    options.push(opts[idx] as string);
    // W413: every option teaches something, right or wrong.
    if (expls[idx] === null) refusals.push({ field: `expl${idx + 1}`, code: 'EXPLANATION_REQUIRED' });
    explanations.push(expls[idx] ?? '');
  }
  if (options.length < MIN_OPTIONS) refusals.push({ field: 'opt1', code: 'OPTIONS_MIN' });

  // THE ANSWER: the option NUMBER, 1-based on the form, 0-based in the row.
  const answerTyped = trimOrNull(i.entered.answer);
  let answer: number | null = null;
  if (answerTyped === null) refusals.push({ field: 'answer', code: 'ANSWER_REQUIRED' });
  else if (!/^\d{1,2}$/.test(answerTyped) || Number(answerTyped) < 1 || Number(answerTyped) > lastFilled + 1 || opts[Number(answerTyped) - 1] === null) refusals.push({ field: 'answer', code: 'ANSWER_NOT_AN_OPTION' });
  else answer = Number(answerTyped) - 1;

  // THE THRESHOLD: quiz-level, carried on every question's form; blank keeps the current one, and the first question
  // must declare it — a quiz with no threshold cannot gate a certificate.
  const thrTyped = trimOrNull(i.entered.passingPct);
  let passingPct: number | null = L?.passingPct ?? null;
  if (thrTyped !== null) { const p = parsePassingPct(thrTyped); if (p === null) refusals.push({ field: 'passingPct', code: 'THRESHOLD_INVALID' }); else passingPct = p; }
  else if (passingPct === null) refusals.push({ field: 'passingPct', code: 'THRESHOLD_REQUIRED' });

  const fields: ReviewField[] = [field('q', i.entered.q ?? null, q)];
  for (let n = 1; n <= MAX_OPTIONS; n++) fields.push(field(`opt${n}`, i.entered[`opt${n}` as QuestionFormField] ?? null, n - 1 <= lastFilled ? opts[n - 1] : null));
  for (let n = 1; n <= MAX_OPTIONS; n++) fields.push(field(`expl${n}`, i.entered[`expl${n}` as QuestionFormField] ?? null, n - 1 <= lastFilled ? expls[n - 1] : null));
  fields.push(field('answer', i.entered.answer ?? null, answer === null ? null : String(answer + 1)));
  fields.push(field('passingPct', i.entered.passingPct ?? null, passingPct === null ? null : `${passingPct}%`));
  refusals.push(...writerRefusals(i.writerIssues ?? [], fields.map((f) => f.name), refusals));

  // The diff "where applicable": an EDIT of an existing question, or a changed threshold.
  let diff: ReviewDiffRow[] | null = null;
  if (L && isEdit) {
    diff = [];
    const cur = L.quiz!.questions[i.questionNo - 1];
    const push = (f: string, before: string | null, after: string | null) => { if (before !== after) diff!.push({ field: f, before, after }); };
    push('q', cur.q, q);
    for (let n = 1; n <= MAX_OPTIONS; n++) push(`opt${n}`, cur.options[n - 1] ?? null, options[n - 1] ?? null);
    for (let n = 1; n <= MAX_OPTIONS; n++) push(`expl${n}`, trimOrNull(cur.explanations[n - 1]), trimOrNull(explanations[n - 1]));
    push('answer', String(cur.answer + 1), answer === null ? null : String(answer + 1));
    push('passingPct', L.passingPct === null ? null : `${L.passingPct}%`, passingPct === null ? null : `${passingPct}%`);
  } else if (L && L.passingPct !== null && passingPct !== L.passingPct) {
    diff = [{ field: 'passingPct', before: `${L.passingPct}%`, after: passingPct === null ? null : `${passingPct}%` }];
  }
  return reviewResult('lesson', fields, refusals, diff);
}

/** The whole quiz document as it will be written when the review is `ready` — the question replaced or appended. */
export function storedQuestion(i: QuestionReviewInput): QuestionStored | null {
  const r = reviewQuestion(i);
  if (!r.ready || !i.lesson) return null;
  const options: string[] = []; const explanations: string[] = [];
  for (let n = 1; n <= MAX_OPTIONS; n++) {
    const o = trimOrNull(i.entered[`opt${n}` as QuestionFormField]);
    if (o === null) break;
    options.push(o); explanations.push(trimOrNull(i.entered[`expl${n}` as QuestionFormField]) as string);
  }
  const question: QuizQuestion = { q: trimOrNull(i.entered.q) as string, options, answer: Number(trimOrNull(i.entered.answer)) - 1, explanations };
  const questions = [...(i.lesson.quiz?.questions ?? [])];
  questions[i.questionNo - 1] = question;
  const thr = trimOrNull(i.entered.passingPct);
  const passingPct = thr === null ? (i.lesson.passingPct as number) : (parsePassingPct(thr) as number);
  return { doc: { questions }, passingPct, questionNo: i.questionNo };
}
