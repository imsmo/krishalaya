// modules/auctions/dto/query-auction.dto.ts · zod .strict() auction list params. Optional status OR grouped tab (W137:
// live · scheduled · awaiting_approval · ended/settled · cancelled/failed) + µs keyset cursor (never OFFSET) + bounded limit.
import { z } from 'zod';
import { AUCTION_STATUSES, AUCTION_GROUPS } from '../domain/auction.state';
export const QueryAuctionsSchema = z.object({
  status: z.enum(AUCTION_STATUSES).optional(),
  group: z.enum(AUCTION_GROUPS).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type QueryAuctionsDto = z.infer<typeof QueryAuctionsSchema>;
