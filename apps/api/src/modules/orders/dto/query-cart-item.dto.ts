// modules/orders/dto/query-cart-item.dto.ts · zod .strict() list params for a cart's items.
// The cart is always the caller's own active cart (resolved server-side) — no cart_id from the client
// (anti-IDOR). Bounded limit; keyset cursor (never OFFSET).
import { z } from 'zod';

export const QueryCartItemsSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryCartItemsDto = z.infer<typeof QueryCartItemsSchema>;
