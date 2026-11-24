// modules/ai-governance/dto/query-ai-model.dto.ts · zod .strict() — browse the (read-only) model registry.
import { z } from 'zod';
import { MODEL_STATUSES } from '../domain/ai-governance.events';
export const QueryModelsSchema = z.object({
  code: z.string().min(1).max(80).optional(),
  status: z.enum(MODEL_STATUSES).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryModelsDto = z.infer<typeof QueryModelsSchema>;
