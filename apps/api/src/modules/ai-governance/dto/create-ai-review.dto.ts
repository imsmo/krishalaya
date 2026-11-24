// modules/ai-governance/dto/create-ai-review.dto.ts · zod .strict() — manually enqueue a review item (ops can
// raise a HITL item not tied to a specific inference, e.g. an out-of-band fraud flag).
import { z } from 'zod';
import { QUEUE_KINDS } from '../domain/ai-governance.events';
export const CreateReviewSchema = z.object({
  queueKind: z.enum(QUEUE_KINDS),
  priority: z.coerce.number().int().min(1).max(1000).prefault(100),
  subjectType: z.string().min(1).max(50).nullish(),
  subjectId: z.string().uuid().nullish(),
}).strict();
export type CreateReviewDto = z.infer<typeof CreateReviewSchema>;
