// modules/memberships/dto/query-membership-tier.dto.ts · list tiers (cursor pagination, never OFFSET).
import { z } from 'zod';
export const QueryTiersSchema = z.object({
  activeOnly: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryTiersDto = z.infer<typeof QueryTiersSchema>;
