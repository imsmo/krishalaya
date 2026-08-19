// modules/dairy/dto/create-milk-rate-card.dto.ts · zod .strict() rate card create (rates as minor-unit strings).
import { z } from 'zod';
import { PRICING_MODELS, ANIMAL_TYPES } from '../domain/dairy.events';
const minorStr = z.string().regex(/^\d{1,15}$/, 'must be a non-negative integer (minor units)');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const CreateRateCardSchema = z.object({
  defaultName: z.string().min(1).max(120),
  animalType: z.enum(ANIMAL_TYPES as unknown as [string, ...string[]]),
  pricingModel: z.enum(PRICING_MODELS as unknown as [string, ...string[]]),
  ratePerKgFatMinor: minorStr.optional(),
  ratePerKgSnfMinor: minorStr.optional(),
  baseRatePerLitreMinor: minorStr.optional(),
  /**
   * [PC-56 TENANT-6b-1] W168's *"Bonus slab: fat >= 6.5 -> +Rs 0.50/L"*, accepted for the first time. Integers only:
   * `minCentiPct` is the threshold x100 (6.5% -> 650) and `bonusMinorPerLitre` is the premium in minor units per litre
   * (Rs 0.50 -> 50), because a decimal here would put a float on the pricing path. Before this wave `bonus_rules` held
   * whatever a seed put there and NOTHING read it.
   */
  bonusSlabs: z.array(z.object({
    metric: z.enum(['fat', 'snf']),
    minCentiPct: z.number().int().min(1).max(10_000),
    bonusMinorPerLitre: z.number().int().min(1).max(1_000_000),
  }).strict()).max(8).optional(),
  effectiveFrom: dateStr,
  effectiveTo: dateStr.optional(),
}).strict();
export type CreateRateCardDto = z.infer<typeof CreateRateCardSchema>;
