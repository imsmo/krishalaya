// modules/catalogue/dto/query-brand.dto.ts · browse global brands (keyset pagination; trigram name search).
import { z } from 'zod';
export const QueryBrandSchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  verifiedOnly: z.coerce.boolean().prefault(false),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryBrandDto = z.infer<typeof QueryBrandSchema>;
