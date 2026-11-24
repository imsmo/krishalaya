// modules/market-intel/dto/create-price-prediction.dto.ts · zod .strict() — generate a baseline band.
import { z } from 'zod';
export const GeneratePredictionSchema = z.object({
  productId: z.string().uuid(),
  regionId: z.string().uuid(),
  gradeOptionId: z.string().uuid().nullish(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lookbackDays: z.coerce.number().int().min(7).max(365).prefault(90),
}).strict();
export type GeneratePredictionDto = z.infer<typeof GeneratePredictionSchema>;
