import { z } from 'zod';
export const QueryPriceHistorySchema = z.object({
  listingId: z.string().uuid(), cursor: z.string().optional(), limit: z.coerce.number().min(1).max(100).prefault(20),
}).strict();
export type QueryPriceHistoryDto = z.infer<typeof QueryPriceHistorySchema>;
