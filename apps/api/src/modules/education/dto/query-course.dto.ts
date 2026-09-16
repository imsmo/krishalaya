// modules/education/dto/query-course.dto.ts · zod .strict() — browse/list courses (keyset).
import { z } from 'zod';
import { COURSE_STATUSES, COURSE_LEVELS } from '../domain/education.events';
export const QueryCoursesSchema = z.object({
  box: z.enum(['browse', 'mine', 'all']).default('browse'),   // browse=published; mine=my-authored; all=admin
  topicId: z.string().uuid().optional(),
  level: z.enum(COURSE_LEVELS as unknown as [string, ...string[]]).optional(),
  status: z.enum(COURSE_STATUSES as unknown as [string, ...string[]]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** PC-56 TENANT-7a · W178's Learners/Completion columns for this page's rows (desk or own courses). */
  withStats: z.coerce.boolean().optional(),
}).strict();
export type QueryCoursesDto = z.infer<typeof QueryCoursesSchema>;
