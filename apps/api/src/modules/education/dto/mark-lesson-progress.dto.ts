// modules/education/dto/mark-lesson-progress.dto.ts · zod .strict() — record progress on a lesson.
// [PC-56 TENANT-SW-f · W417] TWO ADDITIVE, OPTIONAL fields — a client that sends neither is unchanged in shape and in effect:
//   answers  the chosen option per question (0-based; null = left unanswered). On a quiz lesson the SERVER scores it (W413's integer rule)
//            and captures one `quiz_answers` row per question, in the same transaction as the progress write.
//   watch    the interval the app actually played (ISO instants). Without it, the growth of `secondsWatched` is captured as a
//            `progress_delta` watch event at the server's clock — so the existing mobile client feeds the curve without a release.
import { z } from 'zod';
export const MarkProgressSchema = z.object({
  secondsWatched: z.coerce.number().int().min(0).max(86400).default(0),
  quizScore: z.coerce.number().min(0).max(100).nullish(),
  completed: z.boolean().default(false),
  answers: z.array(z.number().int().min(0).max(5).nullable()).min(1).max(50).optional(),
  watch: z.object({ startedAt: z.string().datetime({ offset: true }), endedAt: z.string().datetime({ offset: true }) }).strict().optional(),
}).strict();
export type MarkProgressDto = z.infer<typeof MarkProgressSchema>;
