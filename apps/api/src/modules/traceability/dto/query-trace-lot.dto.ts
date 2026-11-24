// modules/traceability/dto/query-trace-lot.dto.ts · zod .strict() — list the caller's lots (keyset).
import { z } from 'zod';
export const QueryLotsSchema = z.object({
  box: z.enum(['mine', 'all']).prefault('mine'),   // mine=farmer's own; all=trace.manage
  listingId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryLotsDto = z.infer<typeof QueryLotsSchema>;
