// modules/auctions/dto/query-auction-watcher.dto.ts · zod .strict() list params for the caller's watched
// auctions (owner-scoped: the user is the caller). Keyset cursor (never OFFSET) + a bounded limit.
import { z } from 'zod';
export const QueryAuctionWatchersSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryAuctionWatchersDto = z.infer<typeof QueryAuctionWatchersSchema>;
