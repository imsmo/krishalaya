// modules/orders/dto/query-checkout-group.dto.ts · zod .strict() list params for a buyer's checkout
// groups (multi-seller payments). Owner-scoped (the caller is the buyer); keyset cursor, bounded limit.
import { z } from 'zod';

export const QueryCheckoutGroupsSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(20),
}).strict();
export type QueryCheckoutGroupsDto = z.infer<typeof QueryCheckoutGroupsSchema>;
