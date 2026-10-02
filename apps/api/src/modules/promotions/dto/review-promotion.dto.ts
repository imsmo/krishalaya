// modules/promotions/dto/review-promotion.dto.ts · PC-56 TENANT-10b · the REVIEW steps' input (W2721 / W2540).
// Every entry an optional, bounded STRING: a review must answer a mistyped value with its refusal, not 400 on it. Strict —
// an unknown key is still refused (no mass-assignment through a review).
import { z } from 'zod';
const s = (max: number) => z.string().max(max).optional();
export const ReviewPromotionSchema = z.object({
  defaultName: s(200), promoType: s(40), discountType: s(20), percentOff: s(10), amountOffMinor: s(20), maxDiscountMinor: s(20),
  minOrderMinor: s(20), budgetMinor: s(20), startsAt: s(40), endsAt: s(40),
}).strict();
export type ReviewPromotionDto = z.infer<typeof ReviewPromotionSchema>;
export const ReviewCouponSchema = z.object({ promotionId: s(40), code: s(60), maxUses: s(12), perUserLimit: s(8) }).strict();
export type ReviewCouponDto = z.infer<typeof ReviewCouponSchema>;
/** W2543 — a coupon delete carries its reason (F-12). */
export const DeleteCouponSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();
export type DeleteCouponDto = z.infer<typeof DeleteCouponSchema>;
