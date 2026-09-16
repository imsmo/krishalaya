// modules/education/dto/create-course.dto.ts · PC-56 TENANT-7a · the course FORM, as the writer receives it.
//
// ONE SHAPE FOR THE REVIEW AND THE WRITE. The chain's review step (`POST /education/courses/preview`) and the write
// (`POST /education/courses`, `PATCH /education/courses/:id`) take the SAME body — what the form carries: a title, a
// topic CODE from the registry (never a uuid a person cannot type), a level, a price in MAJOR units at the tenant's
// currency scale, a certificate flag and a cover media id. The service resolves every one through `reviewCourse` —
// the same function, the same facts — so a review that said `ready` is a write that is accepted, and a write is
// refused with the review's own codes when it is not (the rule lives in the act, not only in the review: 6d-4).
//
// The review body is the LENIENT one (strings, capped) so a typo is explained by name rather than refused by a
// validator; the write body is the same schema — `writerIssues` is therefore the same schema's complaints, which means
// the belt reports exactly what the writer would say.
import { z } from 'zod';

/** Long enough for any field (title ≤ 250), short enough to bound a body. */
const loose = z.string().max(400);

export const CourseFormSchema = z.object({
  defaultTitle: loose.optional(),
  topicCode: loose.optional(),
  level: loose.optional(),
  priceMajor: loose.optional(),
  certEnabled: loose.optional(),
  coverMediaId: loose.optional(),
}).strict();
export type CourseFormDto = z.infer<typeof CourseFormSchema>;

/** The review may name the course it is an EDIT of. */
export const PreviewCourseSchema = CourseFormSchema.extend({ id: z.string().max(80).optional() }).strict();
export type PreviewCourseDto = z.infer<typeof PreviewCourseSchema>;

/**
 * What the WRITER refuses beyond the reviewer's own reasons: a title over the column's width. Reported as
 * `TOO_LONG` against the field, by `writerIssuesOf(CourseWriterSchema, body)`.
 */
export const CourseWriterSchema = z.object({
  defaultTitle: z.string().min(1).max(250),
  topicCode: z.string().max(60).optional(),
  level: z.string().max(15).optional(),
  priceMajor: z.string().max(20).optional(),
  certEnabled: z.string().max(5).optional(),
  coverMediaId: z.string().max(40).optional(),
}).strict();

/** The reason every act on a course record carries (the mutate chain, W2550). */
export const CourseActSchema = z.object({
  reason: z.string().min(3).max(300),
}).strict();
export type CourseActDto = z.infer<typeof CourseActSchema>;

/** The confirm step asks: may I, and why not — with the reason as typed so far (may be blank). */
export const PreviewActSchema = z.object({
  reason: z.string().max(400).optional(),
}).strict();
export type PreviewActDto = z.infer<typeof PreviewActSchema>;
