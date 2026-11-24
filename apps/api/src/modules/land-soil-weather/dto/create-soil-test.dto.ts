// modules/land-soil-weather/dto/create-soil-test.dto.ts · zod .strict() soil test record payload.
import { z } from 'zod';
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const RecordSoilTestSchema = z.object({
  parcelId: z.string().uuid(),
  labName: z.string().max(200).optional(),
  shcCardNo: z.string().max(60).optional(),
  sampledOn: dateStr,
  results: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  recommendations: z.record(z.string(), z.unknown()).prefault({}),
  reportMediaId: z.string().uuid().optional(),
  validUntil: dateStr.optional(),
}).strict();
export type RecordSoilTestDto = z.infer<typeof RecordSoilTestSchema>;
