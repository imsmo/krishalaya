// modules/warehousing/dto/create-assay-report.dto.ts · zod .strict() assay record payload.
import { z } from 'zod';
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const RecordAssaySchema = z.object({
  storageBookingId: z.string().uuid(),
  assayerName: z.string().min(1).max(200),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  gradeOptionId: z.string().uuid().optional(),
  reportMediaId: z.string().uuid().optional(),
  validUntil: dateStr.optional(),
}).strict();
export type RecordAssayDto = z.infer<typeof RecordAssaySchema>;
