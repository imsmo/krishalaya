// modules/market-intel/dto/query-price-alert.dto.ts · zod .strict() — list the caller's own alerts (keyset).
import { z } from 'zod';
export const QueryAlertsSchema = z.object({
  activeOnly: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryAlertsDto = z.infer<typeof QueryAlertsSchema>;
