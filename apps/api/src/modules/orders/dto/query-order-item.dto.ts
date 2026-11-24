// modules/orders/dto/query-order-item.dto.ts · zod .strict() params for listing an order's line items.
// The order is resolved + visibility-checked server-side (buyer/seller/moderator) — no tenant/owner data
// from the client. An order has a bounded number of lines, so this returns the full (small) set.
import { z } from 'zod';

export const QueryOrderItemsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).prefault(200),
}).strict();
export type QueryOrderItemsDto = z.infer<typeof QueryOrderItemsSchema>;
