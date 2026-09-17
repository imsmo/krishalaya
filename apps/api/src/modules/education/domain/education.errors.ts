// modules/education/domain/education.errors.ts · typed errors, stable codes → HTTP.
import { DomainError } from '../../../shared/errors/app-error';

export class InstructorNotFoundError extends DomainError { constructor(id: string) { super('INSTRUCTOR_NOT_FOUND', `Instructor ${id} not found`, 404, { id }); } }
export class CourseNotFoundError extends DomainError { constructor(id: string) { super('COURSE_NOT_FOUND', `Course ${id} not found`, 404, { id }); } }
export class LessonNotFoundError extends DomainError { constructor(id: string) { super('LESSON_NOT_FOUND', `Lesson ${id} not found`, 404, { id }); } }
export class EnrollmentNotFoundError extends DomainError { constructor(id: string) { super('ENROLLMENT_NOT_FOUND', `Enrollment ${id} not found`, 404, { id }); } }
export class CourseNotPublishedError extends DomainError { constructor(status: string) { super('COURSE_NOT_PUBLISHED', `Course is ${status}, not open for enrollment`, 409, { status }); } }
export class AlreadyEnrolledError extends DomainError { constructor(courseId: string) { super('ALREADY_ENROLLED', `Already enrolled in course ${courseId}`, 409, { courseId }); } }
export class InvalidCourseError extends DomainError { constructor(detail: string) { super('COURSE_INVALID', detail, 422, { detail }); } }
export class InvalidRoyaltyError extends DomainError { constructor(bps: number) { super('ROYALTY_INVALID', `royalty_bps must be 0..10000, got ${bps}`, 422, { bps }); } }
export class CannotEnrollOwnCourseError extends DomainError { constructor() { super('CANNOT_ENROLL_OWN_COURSE', 'An instructor cannot enroll in their own course', 409, {}); } }
export class EducationForbiddenError extends DomainError { constructor(detail = 'forbidden') { super('EDUCATION_FORBIDDEN', detail, 403, {}); } }
// PC-56 TENANT-7a · the two refusals of the course record. Each carries the CODES the review/verdict computed, so a
// console can print the same sentences the confirm screen would have — a 409 with words, never a bare 409.
export class CourseFormRefusedError extends DomainError {
  constructor(refusals: ReadonlyArray<{ field: string | null; code: string }>) {
    super('COURSE_FORM_REFUSED', `Course form refused: ${refusals.map((r) => (r.field ? `${r.field}/${r.code}` : r.code)).join(', ')}`, 422, { refusals });
  }
}
export class CourseActRefusedError extends DomainError {
  constructor(act: string, refusals: readonly string[]) {
    super('COURSE_ACT_REFUSED', `Course act ${act} refused: ${refusals.join(', ')}`, 409, { act, refusals });
  }
}
// PC-56 TENANT-7b · the lesson record's two refusals — the lesson/subtitle/question forms and the lesson acts.
export class LessonFormRefusedError extends DomainError {
  constructor(refusals: ReadonlyArray<{ field: string | null; code: string }>) {
    super('LESSON_FORM_REFUSED', `Lesson form refused: ${refusals.map((r) => (r.field ? `${r.field}/${r.code}` : r.code)).join(', ')}`, 422, { refusals });
  }
}
export class LessonActRefusedError extends DomainError {
  constructor(act: string, refusals: readonly string[]) {
    super('LESSON_ACT_REFUSED', `Lesson act ${act} refused: ${refusals.join(', ')}`, 409, { act, refusals });
  }
}
// PC-56 TENANT-7c · the live class's three refusals — the live form, the live acts, and a member's registration.
export class LiveFormRefusedError extends DomainError {
  constructor(refusals: ReadonlyArray<{ field: string | null; code: string }>) {
    super('LIVE_FORM_REFUSED', `Live class form refused: ${refusals.map((r) => (r.field ? `${r.field}/${r.code}` : r.code)).join(', ')}`, 422, { refusals });
  }
}
export class LiveActRefusedError extends DomainError {
  constructor(act: string, refusals: readonly string[]) {
    super('LIVE_ACT_REFUSED', `Live class act ${act} refused: ${refusals.join(', ')}`, 409, { act, refusals });
  }
}
export class LiveRegisterRefusedError extends DomainError {
  constructor(refusals: readonly string[]) {
    super('LIVE_REGISTER_REFUSED', `Registration refused: ${refusals.join(', ')}`, 409, { refusals });
  }
}
