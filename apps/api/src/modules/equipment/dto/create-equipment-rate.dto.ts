// modules/equipment/dto/create-equipment-rate.dto.ts · zod .strict() rate-card upsert (rate as minor string).
import { z } from 'zod';
import { RATE_BASES } from '../domain/equipment.events';
const minorStr = z.string().regex(/^\d{1,15}$/, 'must be a positive integer (minor units)');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const CreateRateSchema = z.object({
  rateBasis: z.enum(RATE_BASES as unknown as [string, ...string[]]),
  rateMinor: minorStr,
  includesOperator: z.boolean().prefault(true),
  includesFuel: z.boolean().prefault(false),
  effectiveFrom: dateStr.optional(),
  effectiveTo: dateStr.optional(),
}).strict();
export type CreateRateDto = z.infer<typeof CreateRateSchema>;
