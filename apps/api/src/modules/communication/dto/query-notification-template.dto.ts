// modules/communication/dto/query-notification-template.dto.ts · zod .strict() — W180's GET-form filters, keyset.
import { z } from 'zod';
export const QueryTemplatesSchema = z.object({
  eventCode: z.string().max(80).optional(),
  channel: z.string().max(15).optional(),
  languageCode: z.string().max(8).optional(),
  only: z.enum(['all', 'overrides']).default('all'),
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryTemplatesDto = z.infer<typeof QueryTemplatesSchema>;

export const SlotQuerySchema = z.object({
  eventCode: z.string().min(1).max(80),
  channel: z.string().min(1).max(15),
  languageCode: z.string().min(1).max(8),
}).strict();
export type SlotQueryDto = z.infer<typeof SlotQuerySchema>;
