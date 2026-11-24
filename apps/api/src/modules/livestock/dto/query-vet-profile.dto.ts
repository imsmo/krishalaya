// modules/livestock/dto/query-vet-profile.dto.ts · zod .strict() vet browse query (keyset pagination).
import { z } from 'zod';
export const QueryVetsSchema = z.object({
  baseRegionId: z.string().uuid().optional(),
  isAiTechnician: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryVetsDto = z.infer<typeof QueryVetsSchema>;
