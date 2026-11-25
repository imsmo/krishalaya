// modules/ai-governance/dto/resolve-ai-review.dto.ts · zod .strict() — a reviewer's decision on a queue item.
import { z } from 'zod';
export const ResolveReviewSchema = z.object({
  decision: z.enum(['accepted', 'rejected']),
  // PC-56 TEST-1: a decision carries its reason — at least 20 characters once trimmed. Migration 0115's ck_ai_review_decision_note
  // refuses an accepted/rejected row without one, and this DTO used to accept a missing or short note, so the write reached the
  // database and failed there (23514 → an unhandled 500) instead of being refused here by name. Found by the ai-governance
  // integration spec. The rule is the database's; this only makes the API say it first.
  note: z.string().trim().min(20).max(1000),
}).strict();
export type ResolveReviewDto = z.infer<typeof ResolveReviewSchema>;
