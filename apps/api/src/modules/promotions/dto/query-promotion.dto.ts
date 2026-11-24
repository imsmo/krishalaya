// modules/promotions/dto/query-promotion.dto.ts · list/filter (cursor pagination, never OFFSET).
import { z } from 'zod';
export const QueryPromotionsSchema = z.object({
  activeOnly: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(20),
}).strict();
export type QueryPromotionsDto = z.infer<typeof QueryPromotionsSchema>;
