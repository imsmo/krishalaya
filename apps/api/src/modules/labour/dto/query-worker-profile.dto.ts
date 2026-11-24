// modules/labour/dto/query-worker-profile.dto.ts · zod .strict() worker list query (keyset pagination).
import { z } from 'zod';
export const QueryWorkersSchema = z.object({
  villageRegionId: z.string().uuid().optional(),
  ageVerified: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryWorkersDto = z.infer<typeof QueryWorkersSchema>;
