// modules/ai-governance/dto/query-ai-inference.dto.ts · zod .strict() — list the inference audit log.
// Either by subject (subjectType+subjectId) or the tenant timeline; keyset cursor; limit ≤ 100.
import { z } from 'zod';
export const QueryInferencesSchema = z.object({
  subjectType: z.string().min(1).max(50).optional(),
  subjectId: z.string().uuid().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryInferencesDto = z.infer<typeof QueryInferencesSchema>;
