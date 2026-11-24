// modules/warehousing/dto/query-warehouse.dto.ts · zod .strict() warehouse list query (keyset).
import { z } from 'zod';
export const QueryWarehousesSchema = z.object({
  box: z.enum(['mine', 'browse', 'all']).prefault('browse'),  // browse = tenant's own + platform-global (NULL tenant)
  activeOnly: z.coerce.boolean().prefault(true),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryWarehousesDto = z.infer<typeof QueryWarehousesSchema>;
