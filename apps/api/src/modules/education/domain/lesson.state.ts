// modules/education/domain/lesson.state.ts · PC-56 TENANT-7b · STATE MACHINE for course_lessons.status (Law 5).
//   draft → ready   W412 *"Mark ready"* — the instructor's attestation that THIS lesson is complete
//   ready → draft   *reopen* — a ready lesson is not edited in place; it is reopened, edited, and marked ready again,
//                   so `ready` always describes the content as it stands. Both are acts with a reason (lesson-acts.ts).
// W416's gate (course-publish-gate.ts) asks that every lesson be `ready` before a course is submitted.
export const LESSON_STATUSES = ['draft', 'ready'] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

const TRANSITIONS: Readonly<Record<LessonStatus, readonly LessonStatus[]>> = Object.freeze({
  draft: ['ready'],
  ready: ['draft'],
});
export function canLessonTransition(from: LessonStatus, to: LessonStatus): boolean { return TRANSITIONS[from]?.includes(to) ?? false; }
export function isLessonStatus(s: string): s is LessonStatus { return (LESSON_STATUSES as readonly string[]).includes(s); }
