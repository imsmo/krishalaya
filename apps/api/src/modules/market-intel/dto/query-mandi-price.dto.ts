// modules/market-intel/dto/query-mandi-price.dto.ts · zod .strict() — Mandi Pulse price history (keyset by date).
import { z } from 'zod';
export const QueryPricesSchema = z.object({
  productId: z.string().uuid(),
  regionId: z.string().uuid().optional(),
  mandiId: z.string().uuid().optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryPricesDto = z.infer<typeof QueryPricesSchema>;
