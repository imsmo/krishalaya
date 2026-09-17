// modules/education/domain/lesson-acts.ts · PC-56 TENANT-7b · the acts on a lesson, as verdicts — the lesson-mutate chain
// (W2668 confirm → W2669 success → W2670 failure), whose canon names *"Mark ready · Retry"*, and W411's row menu's
// *"move up/down"*. Same shape as 7a's `course-acts.ts`: the confirm screen asks the verdict, the act RE-TAKES it on
// the locked row, and the reasons come in the order a person wants to hear them: permission → ownership → the course's
// stage → the lesson's stage → what the lesson is missing → the reason.
//
//   ready      draft → ready     W412 *"Mark ready"* — refused while the lesson is hollow, its media has not cleared
//                                the scan, or (a quiz) lacks an explanation on some option or a threshold
//   reopen     ready → draft     the way back, so a ready lesson is never edited in place
//   move_up    position − 1      W411's reorder, as an act with a reason (the audit row says why the order changed)
//   move_down  position + 1
//
// W412's *"Retry"* (on *"Couldn't process the video"*) is NOT an act here and is REFUSED BY NAME: this platform has no
// video-processing job to retry. `core/media` stores the bytes and gates them on an antivirus scan (pending → clean |
// infected | failed); a `failed` or `infected` scan is answered by attaching a new upload through the form chain, and a
// button that claimed to re-run a pipeline that does not exist would be a button that lies about what it did.
import { CourseStatus } from './education.events';
import { LessonStatus, canLessonTransition } from './lesson.state';
import { MIN_ACT_REASON, MAX_ACT_REASON } from './course-acts';

export const LESSON_ACTS = ['ready', 'reopen', 'move_up', 'move_down'] as const;
export type LessonAct = (typeof LESSON_ACTS)[number];
export function isLessonAct(s: string): s is LessonAct { return (LESSON_ACTS as readonly string[]).includes(s); }

export const LESSON_ACT_REFUSALS = [
  'NO_PERMISSION', 'NOT_OWNER', 'COURSE_ARCHIVED', 'ILLEGAL_FROM_STATUS',
  'HOLLOW', 'MEDIA_NOT_CLEAN', 'QUIZ_EXPLANATIONS_MISSING', 'QUIZ_THRESHOLD_MISSING',
  'AT_TOP', 'AT_BOTTOM', 'REASON_REQUIRED',
] as const;
export type LessonActRefusal = (typeof LESSON_ACT_REFUSALS)[number];

export interface LessonActInput {
  act: LessonAct;
  canAuthor: boolean; canPublish: boolean; isOwner: boolean;
  courseStatus: CourseStatus;
  lessonStatus: LessonStatus;
  /** From the gate's own `isHollow` over the row as it stands. */
  hollow: boolean;
  /** The lesson's media asset's scan status; null when the lesson has no media (an article, a quiz). */
  mediaScanStatus: string | null;
  /** For a quiz lesson: is every option explained, and is a threshold declared. True for a non-quiz. */
  quizExplained: boolean; quizThresholdSet: boolean;
  /** 1-based position in its module and the module's size — for the two moves. */
  position: number; moduleSize: number;
  reason: string | null | undefined;
}
export interface LessonActVerdict { act: LessonAct; allowed: boolean; refusals: LessonActRefusal[]; to: LessonStatus | null }

const reasonUsable = (r: string | null | undefined) => { const s = (r ?? '').trim(); return s.length >= MIN_ACT_REASON && s.length <= MAX_ACT_REASON; };

export function lessonActVerdict(i: LessonActInput): LessonActVerdict {
  const refusals: LessonActRefusal[] = [];
  if (!(i.canAuthor || i.canPublish)) refusals.push('NO_PERMISSION');
  if (!i.isOwner && !i.canPublish) refusals.push('NOT_OWNER');
  if (i.courseStatus === 'archived') refusals.push('COURSE_ARCHIVED');
  let to: LessonStatus | null = null;
  switch (i.act) {
    case 'ready':
      to = 'ready';
      if (!canLessonTransition(i.lessonStatus, 'ready')) refusals.push('ILLEGAL_FROM_STATUS');
      if (i.hollow) refusals.push('HOLLOW');
      // W412's `queued · processing · ready`, honestly: the only pipeline this platform runs on a file is the scan.
      if (i.mediaScanStatus !== null && i.mediaScanStatus !== 'clean') refusals.push('MEDIA_NOT_CLEAN');
      if (!i.quizExplained) refusals.push('QUIZ_EXPLANATIONS_MISSING');
      if (!i.quizThresholdSet) refusals.push('QUIZ_THRESHOLD_MISSING');
      break;
    case 'reopen':
      to = 'draft';
      if (!canLessonTransition(i.lessonStatus, 'draft')) refusals.push('ILLEGAL_FROM_STATUS');
      break;
    case 'move_up':
      if (i.position <= 1) refusals.push('AT_TOP');
      break;
    case 'move_down':
      if (i.position >= i.moduleSize) refusals.push('AT_BOTTOM');
      break;
  }
  if (!reasonUsable(i.reason)) refusals.push('REASON_REQUIRED');
  return { act: i.act, allowed: refusals.length === 0, refusals, to };
}

/** Every act's verdict for the screen that offers buttons; the reason is the confirm step's question, not the button's. */
export function allLessonVerdicts(base: Omit<LessonActInput, 'act' | 'reason'>): LessonActVerdict[] {
  return LESSON_ACTS.map((act) => lessonActVerdict({ ...base, act, reason: 'placeholder' }));
}
