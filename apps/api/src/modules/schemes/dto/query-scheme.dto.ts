// modules/schemes/dto/query-scheme.dto.ts · zod .strict() scheme browse (read-only) + eligibility check input.
import { z } from 'zod';
export const QuerySchemesSchema = z.object({
  categoryId: z.string().uuid().optional(),
  activeOnly: z.coerce.boolean().prefault(true),
}).strict();
export type QuerySchemesDto = z.infer<typeof QuerySchemesSchema>;

export const CheckEligibilitySchema = z.object({
  roles: z.array(z.string().max(40)).max(20).optional(),
  landholdingAcres: z.number().min(0).max(100000).optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  age: z.number().int().min(0).max(150).optional(),
}).strict();
export type CheckEligibilityDto = z.infer<typeof CheckEligibilitySchema>;
