// modules/catalogue/dto/query-attribute-option.dto.ts · list the dropdown options of one attribute (read).
import { z } from 'zod';
export const QueryAttributeOptionSchema = z.object({
  attributeId: z.string().uuid(),
  activeOnly: z.coerce.boolean().prefault(true),
}).strict();
export type QueryAttributeOptionDto = z.infer<typeof QueryAttributeOptionSchema>;
