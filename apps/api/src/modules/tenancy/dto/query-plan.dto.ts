// modules/tenancy/dto/query-plan.dto.ts · list plans (cursor pagination, never OFFSET).
import { z } from 'zod';
export const QueryPlansSchema = z.object({
  publicOnly: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryPlansDto = z.infer<typeof QueryPlansSchema>;
