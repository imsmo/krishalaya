// modules/education/dto/create-course-lesson.dto.ts · PC-56 TENANT-7b · the lesson FORM, the subtitle FORM and the
// quiz QUESTION form, as the writer receives them — one shape each for the review and the write (7a's rule).
//
// The review body is LENIENT (strings, capped) so a typo is explained by name rather than refused by a validator; the
// writer schema is the same fields with the column widths, and `writerIssuesOf` reports what the writer would refuse
// as `TOO_LONG` / `VALUE_REJECTED` against the field. PC-26's `UpsertLessonSchema` (numbers, a uuid, an opaque `quiz`)
// is gone: the chain carries what a person types.
import { z } from 'zod';
import { LESSON_FORM_FIELDS, SUBTITLE_FORM_FIELDS, MAX_SUBTITLE_BODY } from '../domain/lesson-review';
import { QUESTION_FORM_FIELDS, MAX_QUESTION_TEXT, MAX_OPTION_TEXT, MAX_EXPLANATION_TEXT } from '../domain/quiz';

const loose = z.string().max(400);
const shape = <T extends readonly string[]>(names: T, v: z.ZodTypeAny) => Object.fromEntries(names.map((n) => [n, v.optional()])) as Record<T[number], z.ZodOptional<z.ZodTypeAny>>;

/* ---- the lesson ---- */
export const LessonFormSchema = z.object({
  ...shape(LESSON_FORM_FIELDS, loose),
  body: z.string().max(20_000).optional(),
  chapters: z.string().max(8_000).optional(),
}).strict();
export type LessonFormDto = z.infer<typeof LessonFormSchema>;
export const PreviewLessonSchema = LessonFormSchema.extend({ lessonId: z.string().max(80).optional() }).strict();
export type PreviewLessonDto = z.infer<typeof PreviewLessonSchema>;
export const LessonWriterSchema = z.object({
  moduleNo: z.string().max(3).optional(),
  defaultTitle: z.string().min(1).max(250),
  contentKind: z.string().max(20),
  mediaId: z.string().max(40).optional(),
  body: z.string().max(20_000).optional(),
  duration: z.string().max(12).optional(),
  siblingLessonId: z.string().max(40).optional(),
  thumbnailAt: z.string().max(12).optional(),
  chapters: z.string().max(8_000).optional(),
}).strict();

/* ---- the subtitle track ---- */
export const SubtitleFormSchema = z.object({
  ...shape(SUBTITLE_FORM_FIELDS, loose),
  body: z.string().max(MAX_SUBTITLE_BODY).optional(),
}).strict();
export type SubtitleFormDto = z.infer<typeof SubtitleFormSchema>;
export const SubtitleWriterSchema = z.object({
  languageCode: z.string().min(1).max(8),
  body: z.string().min(1).max(MAX_SUBTITLE_BODY),
  reviewed: z.string().max(5).optional(),
}).strict();

/* ---- one quiz question ---- */
export const QuestionFormSchema = z.object({
  ...shape(QUESTION_FORM_FIELDS, z.string().max(600)),
}).strict();
export type QuestionFormDto = z.infer<typeof QuestionFormSchema>;
export const QuestionWriterSchema = z.object({
  q: z.string().min(1).max(MAX_QUESTION_TEXT),
  ...Object.fromEntries(QUESTION_FORM_FIELDS.filter((f) => f.startsWith('opt')).map((f) => [f, z.string().max(MAX_OPTION_TEXT).optional()])),
  ...Object.fromEntries(QUESTION_FORM_FIELDS.filter((f) => f.startsWith('expl')).map((f) => [f, z.string().max(MAX_EXPLANATION_TEXT).optional()])),
  answer: z.string().max(2).optional(),
  passingPct: z.string().max(4).optional(),
}).strict();

/** The question number the chain addresses — a path segment, validated as a small positive integer. */
export const questionNoOf = (raw: string): number | null => (/^\d{1,3}$/.test(raw) && Number(raw) >= 1 ? Number(raw) : null);

/* ---- the acts ---- */
export const LessonActSchema = z.object({ reason: z.string().min(3).max(300) }).strict();
export type LessonActDto = z.infer<typeof LessonActSchema>;
