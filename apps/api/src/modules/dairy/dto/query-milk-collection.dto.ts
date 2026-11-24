// modules/dairy/dto/query-milk-collection.dto.ts · zod .strict() collection list query (partition-pruned by date).
import { z } from 'zod';
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const QueryCollectionsSchema = z.object({
  membershipId: z.string().uuid(),
  from: dateStr,
  to: dateStr,
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryCollectionsDto = z.infer<typeof QueryCollectionsSchema>;
