// modules/auctions/dto/query-bid.dto.ts · zod .strict() bid-history list params for an auction. Keyset
// cursor (never OFFSET) + bounded limit. Sealed-auction amounts stay hidden until close (read-model).
import { z } from 'zod';
export const QueryBidsSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryBidsDto = z.infer<typeof QueryBidsSchema>;
