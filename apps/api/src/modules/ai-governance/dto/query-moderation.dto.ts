// modules/ai-governance/dto/query-moderation.dto.ts · zod .strict() — list moderation reports (default: open).
import { z } from 'zod';
export const QueryModerationSchema = z.object({
  box: z.enum(['open', 'all']).prefault('open'),
  subjectType: z.string().min(1).max(50).optional(),
  subjectId: z.string().uuid().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryModerationDto = z.infer<typeof QueryModerationSchema>;
