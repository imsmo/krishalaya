// apps/mobile/src/features/education/education.api.ts · data layer for training/courses (P-16). Keeps screens thin
// (guide §3). Reads degrade-never-die (null/empty). enroll is idempotent (Law 3) and throws so the screen shows
// the precise outcome (402 payment-required / 409 already-enrolled). markProgress is an online write that throws.
// Money is bigint minor strings (Law 2); a paid enroll moves money SERVER-SIDE (the app never does — Law 11).
import type { Course, CourseLesson, Enrollment, LessonProgress } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { newId } from '../../core/util/ids';

export interface CoursesPage { items: Course[]; nextCursor: string | null }
export interface EnrollmentsPage { items: Enrollment[]; nextCursor: string | null }

// S6-prep: education is feature-flag OFF at pilot — the guard 404s. Remember "off" for the app
// session so focus-driven refetches don't hammer the API / flood the dev log (restart re-checks).
let educationOffThisSession = false;
export async function browseCourses(cursor?: string): Promise<CoursesPage> {
  if (educationOffThisSession) return { items: [], nextCursor: null };
  try { return await apiClient().courses.list({ box: 'browse', cursor }); }
  catch (e) {
    if ((e as { status?: number })?.status === 404) educationOffThisSession = true;   // flag-off, not transient
    return { items: [], nextCursor: null };
  }
}
export async function getCourse(id: string): Promise<(Course & { lessons?: CourseLesson[] }) | null> {
  try { return await apiClient().courses.get(id); } catch { return null; }
}
export async function getLessons(courseId: string): Promise<CourseLesson[]> {
  try { return await apiClient().courses.lessons(courseId); } catch { return []; }
}
export async function myEnrollments(cursor?: string): Promise<EnrollmentsPage> {
  try { return await apiClient().enrollments.list({ cursor }); } catch { return { items: [], nextCursor: null }; }
}
export async function getEnrollment(id: string): Promise<Enrollment | null> {
  try { return await apiClient().enrollments.get(id); } catch { return null; }
}
export async function getProgress(enrollmentId: string): Promise<LessonProgress[]> {
  try { return await apiClient().enrollments.listProgress(enrollmentId); } catch { return []; }
}
/** A presigned, time-bounded URL for a lesson's video/media (only returned for a clean asset). Null on failure. */
export async function lessonMediaUrl(mediaId: string): Promise<string | null> {
  try { return (await apiClient().media.downloadUrl(mediaId)).url; } catch { return null; }
}

// --- mutations (throw on a real error) ---
export function enroll(courseId: string): Promise<Enrollment> {
  return apiClient().enrollments.enroll(courseId, newId());
}
export function markProgress(enrollmentId: string, lessonId: string, input: { secondsWatched?: number; quizScore?: number | null; completed?: boolean }): Promise<LessonProgress> {
  return apiClient().enrollments.markProgress(enrollmentId, lessonId, input);
}
