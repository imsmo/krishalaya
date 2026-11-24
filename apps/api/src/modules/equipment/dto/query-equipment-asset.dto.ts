// modules/equipment/dto/query-equipment-asset.dto.ts · zod .strict() asset list query (keyset).
import { z } from 'zod';
import { ASSET_STATUSES } from '../domain/equipment.events';
export const QueryAssetsSchema = z.object({
  box: z.enum(['mine', 'browse', 'all']).prefault('browse'),  // mine=owner's; browse=active marketplace; all=admin
  categoryId: z.string().uuid().optional(),
  status: z.enum(ASSET_STATUSES as unknown as [string, ...string[]]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryAssetsDto = z.infer<typeof QueryAssetsSchema>;
