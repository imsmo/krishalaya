// modules/ai-governance/dto/query-ai-review.dto.ts · zod .strict() — list the review queue (default: open).
import { z } from 'zod';
import { REVIEW_STATUSES, QUEUE_KINDS } from '../domain/ai-governance.events';
export const QueryReviewsSchema = z.object({
  box: z.enum(['open', 'all']).prefault('open'),
  status: z.enum(REVIEW_STATUSES).optional(),
  queueKind: z.enum(QUEUE_KINDS).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryReviewsDto = z.infer<typeof QueryReviewsSchema>;
