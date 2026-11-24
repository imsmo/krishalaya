// modules/disputes/dto/query-return.dto.ts · zod .strict() list params. Keyset pagination only (opaque
// base64 cursor; never OFFSET) + a bounded limit. `box` scopes to the caller's role on the order:
// 'mine' (buyer's own requests), 'against' (returns on the seller's orders), 'all' (moderator only).
import { z } from 'zod';
import { RETURN_STATUSES } from '../domain/return.state';

export const QueryReturnsSchema = z.object({
  box: z.enum(['mine', 'against', 'all']).prefault('mine'),
  status: z.enum(RETURN_STATUSES).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(20),
}).strict();
export type QueryReturnsDto = z.infer<typeof QueryReturnsSchema>;
