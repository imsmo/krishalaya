// modules/promotions/dto/create-promotion.dto.ts · zod .strict() (rejects unknown keys → no mass-assignment).
// PC-56 TENANT-10b: the SHAPE is checked here; the RULES (budget required, the types with an engine, a cap only for a
// percent rule, the window) are the review's own (domain/promotion.rules), re-run by the act — so an uncapped promotion or
// a cashback one is refused BY NAME (PROMOTION_REFUSED · BUDGET_REQUIRED / PROMO_TYPE_NO_ENGINE), not by a validator.
import { z } from 'zod';
import { PROMO_TYPES, DISCOUNT_TYPES } from '../domain/promotions.events';

const minorPos = z.string().regex(/^[1-9]\d{0,15}$/, 'must be a positive integer string of minor units');
const minor0 = z.string().regex(/^\d{1,16}$/, 'must be a non-negative integer string of minor units');

export const PromoRulesSchema = z.object({
  discountType: z.enum(DISCOUNT_TYPES as unknown as [string, ...string[]]),
  percentOff: z.number().int().min(1).max(100).optional(),
  amountOffMinor: minorPos.optional(),
  minOrderMinor: minor0.optional(),
  maxDiscountMinor: minorPos.optional(),
}).strict();

export const CreatePromotionSchema = z.object({
  promoType: z.enum(PROMO_TYPES as unknown as [string, ...string[]]),
  defaultName: z.string().min(3).max(150),
  rules: PromoRulesSchema,
  budgetMinor: minor0.optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
}).strict();
export type CreatePromotionDto = z.infer<typeof CreatePromotionSchema>;
