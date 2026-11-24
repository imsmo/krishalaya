// modules/promotions/dto/query-coupon.dto.ts · list a promotion's coupons (cursor pagination).
import { z } from 'zod';
export const QueryCouponsSchema = z.object({
  promotionId: z.string().uuid(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(20),
}).strict();
export type QueryCouponsDto = z.infer<typeof QueryCouponsSchema>;
