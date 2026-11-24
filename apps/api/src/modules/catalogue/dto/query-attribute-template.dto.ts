// modules/catalogue/dto/query-attribute-template.dto.ts · browse clonable presets (keyset pagination).
import { z } from 'zod';
export const QueryAttributeTemplateSchema = z.object({
  categoryId: z.string().uuid().optional(),
  code: z.string().max(80).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryAttributeTemplateDto = z.infer<typeof QueryAttributeTemplateSchema>;
