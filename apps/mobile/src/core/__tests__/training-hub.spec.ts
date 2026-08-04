// Unit tests for the PURE Training-Hub derivations (features/ambassador/training-hub, screen 94). §13: status
// comes only from real progress (completedAt / secondsWatched); no language or lock is invented.
import { lessonStatus, minutesWatched, minutesRemaining, hubSummary, sortLessons, moduleCount, nextLessons } from '../../features/ambassador/training-hub';
import type { CourseLesson, LessonProgress } from '@krishalaya/sdk-js';

const lesson = (id: string, moduleNo: number, lessonNo: number, durationSecs: number | null): CourseLesson =>
  ({ id, courseId: 'c1', moduleNo, lessonNo, defaultTitle: id, contentKind: 'video', mediaId: null, body: null, durationSecs, quiz: null } as CourseLesson);
const prog = (lessonId: string, completedAt: string | null, secondsWatched: number): LessonProgress =>
  ({ lessonId, completedAt, secondsWatched, quizScore: null });

describe('lessonStatus', () => {
  const p = [prog('a', '2026-08-01T00:00:00Z', 300), prog('b', null, 120), prog('c', null, 0)];
  it('classifies completed / watching / notStarted', () => {
    expect(lessonStatus(p, 'a')).toBe('completed');
    expect(lessonStatus(p, 'b')).toBe('watching');
    expect(lessonStatus(p, 'c')).toBe('notStarted');
    expect(lessonStatus(p, 'z')).toBe('notStarted');
    expect(lessonStatus(null, 'a')).toBe('notStarted');
  });
});

describe('minutesWatched', () => {
  it('floors seconds to whole minutes', () => {
    expect(minutesWatched([prog('a', null, 150)], 'a')).toBe(2);
    expect(minutesWatched([prog('a', null, 0)], 'a')).toBe(0);
    expect(minutesWatched([], 'a')).toBe(0);
  });
});

describe('minutesRemaining', () => {
  const lessons = [lesson('a', 1, 1, 600), lesson('b', 1, 2, 300), lesson('c', 2, 1, 300)];
  it('sums remaining over not-completed lessons (duration − watched)', () => {
    const p = [prog('a', '2026-08-01T00:00:00Z', 600), prog('b', null, 120)];
    // a completed → skip; b: 300-120=180; c: 300-0=300 → 480s → 8 min
    expect(minutesRemaining(lessons, p)).toBe(8);
  });
  it('handles null durations + empty', () => {
    expect(minutesRemaining([lesson('a', 1, 1, null)], [])).toBe(0);
    expect(minutesRemaining([], [])).toBe(0);
  });
});

describe('hubSummary', () => {
  it('counts videos + completed + minutes remaining', () => {
    const lessons = [lesson('a', 1, 1, 600), lesson('b', 1, 2, 300)];
    const p = [prog('a', '2026-08-01T00:00:00Z', 600)];
    expect(hubSummary(lessons, p)).toEqual({ videos: 2, completed: 1, minsRemaining: 5 });
  });
});

describe('sortLessons', () => {
  it('orders by moduleNo then lessonNo without mutating', () => {
    const input = [lesson('c', 2, 1, 0), lesson('a', 1, 1, 0), lesson('b', 1, 2, 0)];
    expect(sortLessons(input).map((l) => l.id)).toEqual(['a', 'b', 'c']);
    expect(input.map((l) => l.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('moduleCount', () => {
  it('counts distinct modules', () => {
    expect(moduleCount([lesson('a', 1, 1, 0), lesson('b', 1, 2, 0), lesson('c', 2, 1, 0)])).toBe(2);
    expect(moduleCount([])).toBe(0);
  });
});

describe('nextLessons', () => {
  const ls = [lesson('a', 1, 1, 0), lesson('b', 1, 2, 0), lesson('c', 2, 1, 0), lesson('d', 2, 2, 0)];
  it('returns the lessons after the current one, capped', () => {
    expect(nextLessons(ls, 'b', 2).map((l) => l.id)).toEqual(['c', 'd']);
    expect(nextLessons(ls, 'd').map((l) => l.id)).toEqual([]);
    expect(nextLessons(ls, 'zzz')).toEqual([]);
  });
});
