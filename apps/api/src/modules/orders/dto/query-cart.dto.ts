// modules/orders/dto/query-cart.dto.ts · zod .strict() cart status filter (carts.status: active|converted|
// abandoned). The cart is always owner-scoped (the caller); the status defaults to the live active cart.
import { z } from 'zod';

export const CART_STATUSES = ['active', 'converted', 'abandoned'] as const;
export const QueryCartSchema = z.object({
  status: z.enum(CART_STATUSES).prefault('active'),
}).strict();
export type QueryCartDto = z.infer<typeof QueryCartSchema>;
