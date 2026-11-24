// modules/market-intel/dto/query-mandi.dto.ts · zod .strict() — browse the mandi registry (keyset).
import { z } from 'zod';
export const QueryMandisSchema = z.object({
  regionId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryMandisDto = z.infer<typeof QueryMandisSchema>;
