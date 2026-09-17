// modules/education/domain/course-lesson.entity.ts · a lesson within a course (ordered by module_no, lesson_no).
//
// PC-56 TENANT-7b — THE LESSON RECORD. Migration 0171 gave the row what W411/W412/W413 describe and 7a's gate could not
// measure: a state of its own (`draft | ready`, W412 *"Mark ready"*), the audio-only twin of a video (`siblingLessonId`,
// W411's rule), the thumbnail as a second into THIS lesson's own video (`thumbnailFrameSecs`, W412 *"frame at 02:31"*),
// chapter marks (`chapters`), and the quiz's certificate threshold (`quizPassingPct`, W413). Transitions live in
// `lesson.state.ts` (Law 5); this entity only performs them.
import { ContentKind } from './education.events';
import { InvalidCourseError } from './education.errors';
import { LessonStatus, canLessonTransition } from './lesson.state';

export interface LessonChapter { at: number; title: string }

export interface CourseLessonProps {
  id: string; courseId: string; moduleNo: number; lessonNo: number; defaultTitle: string; contentKind: ContentKind;
  mediaId: string | null; body: string | null; durationSecs: number | null; quiz: unknown | null; createdAt?: Date;
  /* 0171 */
  status: LessonStatus; readyAt: Date | null; readyBy: string | null;
  siblingLessonId: string | null; thumbnailFrameSecs: number | null; chapters: LessonChapter[]; quizPassingPct: number | null;
}
export type LessonContent = Pick<CourseLessonProps, 'defaultTitle' | 'contentKind' | 'mediaId' | 'body' | 'durationSecs' | 'siblingLessonId' | 'thumbnailFrameSecs' | 'chapters'>;

export class CourseLesson {
  private constructor(private props: CourseLessonProps) {}
  static create(input: Omit<CourseLessonProps, 'status' | 'readyAt' | 'readyBy'>): CourseLesson {
    if (!input.defaultTitle) throw new InvalidCourseError('lesson title required');
    if (input.lessonNo < 1 || input.moduleNo < 1) throw new InvalidCourseError('module_no/lesson_no start at 1');
    return new CourseLesson({ ...input, status: 'draft', readyAt: null, readyBy: null });
  }
  static rehydrate(p: CourseLessonProps): CourseLesson { return new CourseLesson(p); }
  get id() { return this.props.id; }
  get courseId() { return this.props.courseId; }
  get status() { return this.props.status; }
  get contentKind() { return this.props.contentKind; }
  toProps(): Readonly<CourseLessonProps> { return Object.freeze({ ...this.props, chapters: [...this.props.chapters] }); }

  /** The form chain's edit: content only — position is the reorder act's, state is the acts'. */
  updateContent(c: LessonContent): void {
    if (this.props.status !== 'draft') throw new InvalidCourseError('a ready lesson is reopened before it is edited');
    this.props = { ...this.props, ...c, chapters: [...c.chapters] };
  }
  /** The quiz chain's write: the question set and the threshold. */
  setQuiz(quiz: unknown, passingPct: number | null): void {
    this.props = { ...this.props, quiz, quizPassingPct: passingPct };
  }
  markReady(by: string, at: Date): void {
    if (!canLessonTransition(this.props.status, 'ready')) throw new InvalidCourseError(`lesson ${this.props.status} → ready is not a transition`);
    this.props = { ...this.props, status: 'ready', readyAt: at, readyBy: by };
  }
  reopen(): void {
    if (!canLessonTransition(this.props.status, 'draft')) throw new InvalidCourseError(`lesson ${this.props.status} → draft is not a transition`);
    this.props = { ...this.props, status: 'draft', readyAt: null, readyBy: null };
  }
  toJSON() {
    const v = this.props;
    return {
      id: v.id, courseId: v.courseId, moduleNo: v.moduleNo, lessonNo: v.lessonNo, defaultTitle: v.defaultTitle, contentKind: v.contentKind,
      mediaId: v.mediaId, body: v.body, durationSecs: v.durationSecs, quiz: v.quiz, createdAt: v.createdAt,
      status: v.status, readyAt: v.readyAt, readyBy: v.readyBy,
      siblingLessonId: v.siblingLessonId, thumbnailFrameSecs: v.thumbnailFrameSecs, chapters: v.chapters, quizPassingPct: v.quizPassingPct,
    };
  }
}
