// modules/promotions/dto/query-coupon-all.dto.ts · PC-56 TENANT-10b · B1 — the tenant-wide coupon list (W130) and one
// coupon's redemptions panel. Cursor pagination (µs keyset), never OFFSET.
import { z } from 'zod';
export const QueryCouponsAllSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type QueryCouponsAllDto = z.infer<typeof QueryCouponsAllSchema>;
