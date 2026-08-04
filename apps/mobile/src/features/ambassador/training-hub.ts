// apps/mobile/src/features/ambassador/training-hub.ts · PURE derivations for the Ambassador Training Hub (94).
// No React/native (SDK types are `import type` → erased) → unit-tested. Composes the education contract
// (CourseLesson + LessonProgress) into the hub's summary + per-lesson status.
//
// §13 (NOT faked): CourseLesson exposes {moduleNo, lessonNo, defaultTitle, contentKind, durationSecs} and
// LessonProgress exposes {completedAt, secondsWatched} — there is NO per-lesson language/subtitle field and NO
// prerequisite/lock field. So the screen shows the REAL status (completed / watching / not-started) and never a
// fabricated "Hindi · Gujarati subtitles" or a "🔒 After KYC tutorial" lock. Section titles use the real course
// title (defaultTitle); a module without a title is grouped by its real moduleNo, never an invented name.
import type { CourseLesson, LessonProgress } from '@krishalaya/sdk-js';

export type LessonStatus = 'completed' | 'watching' | 'notStarted';

/** Real per-lesson status from progress: completed (has completedAt) → watching (secondsWatched > 0) → notStarted. */
export function lessonStatus(progress: readonly LessonProgress[] | null | undefined, lessonId: string): LessonStatus {
  const p = (progress ?? []).find((x) => x.lessonId === lessonId);
  if (!p) return 'notStarted';
  if (p.completedAt) return 'completed';
  return p.secondsWatched > 0 ? 'watching' : 'notStarted';
}

/** Minutes already watched of a lesson (0 when no progress). Pure, floor to whole minutes. */
export function minutesWatched(progress: readonly LessonProgress[] | null | undefined, lessonId: string): number {
  const p = (progress ?? []).find((x) => x.lessonId === lessonId);
  return p ? Math.floor(Math.max(0, p.secondsWatched) / 60) : 0;
}

/** Minutes remaining across the given lessons = Σ max(0, duration − watched) over NOT-completed lessons. */
export function minutesRemaining(lessons: readonly CourseLesson[] | null | undefined, progress: readonly LessonProgress[] | null | undefined): number {
  let secs = 0;
  for (const l of lessons ?? []) {
    if (lessonStatus(progress, l.id) === 'completed') continue;
    const dur = Math.max(0, l.durationSecs ?? 0);
    const watched = (progress ?? []).find((p) => p.lessonId === l.id)?.secondsWatched ?? 0;
    secs += Math.max(0, dur - Math.max(0, watched));
  }
  return Math.round(secs / 60);
}

export interface HubSummary { videos: number; completed: number; minsRemaining: number }
/** The hub header counts across all lessons. Pure. */
export function hubSummary(lessons: readonly CourseLesson[] | null | undefined, progress: readonly LessonProgress[] | null | undefined): HubSummary {
  const list = lessons ?? [];
  const completed = list.filter((l) => lessonStatus(progress, l.id) === 'completed').length;
  return { videos: list.length, completed, minsRemaining: minutesRemaining(list, progress) };
}

/** Lessons in stable display order: moduleNo asc, then lessonNo asc. Pure (does not mutate input). */
export function sortLessons(lessons: readonly CourseLesson[] | null | undefined): CourseLesson[] {
  return [...(lessons ?? [])].sort((a, b) => (a.moduleNo - b.moduleNo) || (a.lessonNo - b.lessonNo));
}

/** Distinct module count in a course (the "of N" in "Module 2 of N"). Pure. */
export function moduleCount(lessons: readonly CourseLesson[] | null | undefined): number {
  return new Set((lessons ?? []).map((l) => l.moduleNo)).size;
}

/** The lessons that come AFTER `currentId` in display order (drives the "Up next" list). Pure; capped by limit. */
export function nextLessons(lessons: readonly CourseLesson[] | null | undefined, currentId: string, limit = 3): CourseLesson[] {
  const sorted = sortLessons(lessons);
  const i = sorted.findIndex((l) => l.id === currentId);
  return i < 0 ? [] : sorted.slice(i + 1, i + 1 + limit);
}
