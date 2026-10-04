// modules/education/domain/learner-insights.ts · PC-56 TENANT-SW-f · W417 — learner insights: the new CAPTURE (per-question quiz answers,
// watch intervals) and the 50-LEARNER FLOOR (founder decision). Pure rules; no I/O.
//
// WHAT IS SHOWN, AND WHEN.
//   • The per-lesson drop-off funnel is real from day one: `lesson_progress` rows (started) and their `completed_at` (completed).
//   • The quiz-miss heatmap and the evening usage curve need CAPTURED data that did not exist before 0202, and print ONLY when the lesson
//     has ≥ 50 distinct learners with captured data. Below that they are REFUSED BY NAME (`BELOW_LEARNER_FLOOR`) with the real count and
//     the floor — "small cohorts stay anonymous, by design". Before any capture: "no answers captured yet — capture began <date>".
//   • "Fix suggestion: recompress the images" is REFUSED BY NAME (`NO_ADVISORY_GENERATOR`): no generator exists.
// The method sentences are seeded en / hi / gu (seed core/0029, `insights.method.<code>`); the English here IS the seed's English.
import type { QuizDoc } from './quiz';

export const LEARNER_FLOOR = 50;
export const LEARNER_REFUSED = { floor: 'BELOW_LEARNER_FLOOR', advisory: 'NO_ADVISORY_GENERATOR', noCapture: 'NO_CAPTURE_YET' } as const;
export const LEARNER_METHODS = {
  funnel: 'Funnel = per lesson, the learners with a progress record on it (started) and those who completed it. Source: lesson progress.',
  quiz_miss: 'Missed = per question, the share of captured answers that were not correct (an unanswered question counts as missed), over every attempt, in basis points rounded down. Shown only when at least 50 distinct learners have captured answers on the lesson. Source: quiz answers.',
  watch_curve: 'Watch seconds by IST hour = the seconds learners played, placed in the IST hour they started: the app\'s own interval when it sends one, otherwise the growth in seconds watched placed at the time the server received the report. Shown only at 50 distinct learners. Source: watch events.',
} as const;
export const LEARNER_REFUSAL_SENTENCES = {
  BELOW_LEARNER_FLOOR: 'Not shown yet: this lesson needs at least 50 learners with captured data before per-lesson numbers show — small cohorts stay anonymous, by design.',
  NO_ADVISORY_GENERATOR: 'No fix suggestion is shown: no advisory generator exists on this platform; the drop-off is shown as it is.',
  NO_CAPTURE_YET: 'No answers or watch time captured yet for this lesson. Capture began when this release was installed; nothing before that exists.',
} as const;

/** A captured answer per question. `answers[i]` is the chosen option (0-based) or null/undefined = unanswered (counts as not correct). */
export function captureAnswers(doc: QuizDoc, answers: ReadonlyArray<number | null | undefined>): Array<{ questionNo: number; chosen: number | null; correct: boolean }> {
  return doc.questions.map((q, i) => {
    const a = answers[i];
    const chosen = Number.isInteger(a) && (a as number) >= 0 && (a as number) < q.options.length ? (a as number) : null;
    return { questionNo: i + 1, chosen, correct: chosen !== null && chosen === q.answer };
  });
}

export type WatchVerdict = { ok: true; seconds: number } | { ok: false; code: 'WATCH_INTERVAL_INVALID' };
/** The app's own played interval: ended after started, not in the future (1 min skew), not older than 24 h, at most 24 h long. */
export function checkWatchInterval(startedAt: Date, endedAt: Date, now: Date): WatchVerdict {
  const s = startedAt.getTime(); const e = endedAt.getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return { ok: false, code: 'WATCH_INTERVAL_INVALID' };
  if (e > now.getTime() + 60_000 || s < now.getTime() - 24 * 3_600_000) return { ok: false, code: 'WATCH_INTERVAL_INVALID' };
  const seconds = Math.round((e - s) / 1000);
  if (seconds < 1 || seconds > 86_400) return { ok: false, code: 'WATCH_INTERVAL_INVALID' };
  return { ok: true, seconds };
}
/** The growth of seconds watched between two progress reports (never negative — seconds_watched only grows, GREATEST). */
export function progressDelta(previous: number | null, next: number): number {
  const p = previous ?? 0;
  return next > p ? Math.min(next - p, 86_400) : 0;
}

export type FloorVerdict = { kind: 'shown'; learners: number; floor: number } | { kind: 'refused'; code: typeof LEARNER_REFUSED.floor | typeof LEARNER_REFUSED.noCapture; learners: number; floor: number };
/** The 50-learner floor. Zero captured learners is its own sentence ("capture began …"); 1–49 is the floor's. */
export function floorVerdict(distinctLearners: number, floor = LEARNER_FLOOR): FloorVerdict {
  if (distinctLearners <= 0) return { kind: 'refused', code: LEARNER_REFUSED.noCapture, learners: 0, floor };
  if (distinctLearners < floor) return { kind: 'refused', code: LEARNER_REFUSED.floor, learners: distinctLearners, floor };
  return { kind: 'shown', learners: distinctLearners, floor };
}

/** Missed share in basis points, rounded down. */
export function missBps(missed: number, total: number): number | null {
  if (!Number.isInteger(missed) || !Number.isInteger(total) || total <= 0 || missed < 0) return null;
  return Math.floor((missed * 10_000) / total);
}
