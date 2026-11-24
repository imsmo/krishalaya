// modules/promotions/dto/query-coupon-redemption.dto.ts · the caller's own redemptions (cursor pagination).
import { z } from 'zod';
export const QueryRedemptionsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(20),
}).strict();
export type QueryRedemptionsDto = z.infer<typeof QueryRedemptionsSchema>;
