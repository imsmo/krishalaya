// Unit tests for the PURE learning logic (features/education/learn): defensive quiz parsing, integer scoring, and
// progress computation. The server is authoritative on stored score + enrollment %; these drive the UX.
import { parseQuiz, scoreQuiz, passThreshold, lessonCompleted, courseProgressPct, isCourseComplete, nextLessonId, QUIZ_PASS_PCT } from '../../features/education/learn';
import type { LessonProgress } from '@krishalaya/sdk-js';

const prog = (lessonId: string, completed: boolean): LessonProgress => ({ lessonId, completedAt: completed ? '2026-01-01' : null, secondsWatched: 0, quizScore: null });

describe('parseQuiz', () => {
  it('parses the canonical { questions:[{q,options,answer}] } shape', () => {
    const q = parseQuiz({ questions: [{ q: 'Best time to sow?', options: ['Mon', 'Kharif', 'Never'], answer: 1 }] });
    expect(q).toHaveLength(1);
    expect(q![0]).toEqual({ q: 'Best time to sow?', options: ['Mon', 'Kharif', 'Never'], answer: 1 });
  });
  it('accepts a bare array + alternate keys (question/choices/correctIndex)', () => {
    const q = parseQuiz([{ question: 'A?', choices: ['x', 'y'], correctIndex: 0 }]);
    expect(q).toHaveLength(1);
    expect(q![0].answer).toBe(0);
  });
  it('returns null for malformed / empty / out-of-range', () => {
    expect(parseQuiz(null)).toBeNull();
    expect(parseQuiz({})).toBeNull();
    expect(parseQuiz({ questions: [] })).toBeNull();
    expect(parseQuiz({ questions: [{ q: 'x', options: ['only-one'], answer: 0 }] })).toBeNull();   // <2 options
    expect(parseQuiz({ questions: [{ q: 'x', options: ['a', 'b'], answer: 5 }] })).toBeNull();       // answer OOB
    expect(parseQuiz({ questions: [{ q: 1, options: ['a', 'b'], answer: 0 }] })).toBeNull();         // q not string
  });
  it('carries an author-supplied hint but never invents one', () => {
    const withHint = parseQuiz({ questions: [{ q: 'x', options: ['a', 'b'], answer: 0, hint: 'think fallback' }] });
    expect(withHint![0].hint).toBe('think fallback');
    const noHint = parseQuiz({ questions: [{ q: 'x', options: ['a', 'b'], answer: 0 }] });
    expect(noHint![0].hint).toBeUndefined();
    const blankHint = parseQuiz({ questions: [{ q: 'x', options: ['a', 'b'], answer: 0, hint: '  ' }] });
    expect(blankHint![0].hint).toBeUndefined();
  });
});

describe('passThreshold', () => {
  it('is ceil(QUIZ_PASS_PCT * total / 100), not a hardcoded 4/5', () => {
    expect(passThreshold(5)).toBe(3);   // 60% of 5 = 3.0 → 3
    expect(passThreshold(4)).toBe(3);   // 2.4 → 3
    expect(passThreshold(1)).toBe(1);
    expect(passThreshold(0)).toBe(0);
  });
});

describe('scoreQuiz', () => {
  const qs = [
    { q: 'q1', options: ['a', 'b'], answer: 0 },
    { q: 'q2', options: ['a', 'b'], answer: 1 },
    { q: 'q3', options: ['a', 'b', 'c'], answer: 2 },
  ];
  it('scores correct answers as an integer pct + pass flag', () => {
    expect(scoreQuiz(qs, [0, 1, 2])).toEqual({ correct: 3, total: 3, scorePct: 100, passed: true });
    expect(scoreQuiz(qs, [0, 0, 0])).toEqual({ correct: 1, total: 3, scorePct: 33, passed: false });
  });
  it('treats unanswered as wrong; pass threshold is QUIZ_PASS_PCT', () => {
    const r = scoreQuiz(qs, [0, 1, null]);
    expect(r.correct).toBe(2);
    expect(r.scorePct).toBe(67);
    expect(r.passed).toBe(67 >= QUIZ_PASS_PCT);
  });
  it('empty quiz → 0, not passed', () => {
    expect(scoreQuiz([], [])).toEqual({ correct: 0, total: 0, scorePct: 0, passed: false });
  });
});

describe('progress helpers', () => {
  const lessons = [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }, { id: 'l4' }];
  const progress = [prog('l1', true), prog('l2', true), prog('l3', false)];
  it('lessonCompleted reflects completedAt', () => {
    expect(lessonCompleted(progress, 'l1')).toBe(true);
    expect(lessonCompleted(progress, 'l3')).toBe(false);
    expect(lessonCompleted(progress, 'l4')).toBe(false);
  });
  it('courseProgressPct = completed / total', () => {
    expect(courseProgressPct(lessons, progress)).toBe(50);  // 2 of 4
    expect(courseProgressPct([], progress)).toBe(0);
  });
  it('nextLessonId returns the first incomplete lesson', () => {
    expect(nextLessonId(lessons, progress)).toBe('l3');
    expect(nextLessonId([{ id: 'l1' }], [prog('l1', true)])).toBeNull();
  });
  it('isCourseComplete reflects the server completedAt', () => {
    expect(isCourseComplete({ completedAt: '2026-01-01' })).toBe(true);
    expect(isCourseComplete({ completedAt: null })).toBe(false);
    expect(isCourseComplete(null)).toBe(false);
  });
});
