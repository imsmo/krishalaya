// modules/livestock/dto/query-animal.dto.ts · zod .strict() animal list query (keyset pagination).
import { z } from 'zod';
import { ANIMAL_STATUSES } from '../domain/animal.state';
export const QueryAnimalsSchema = z.object({
  box: z.enum(['mine', 'all']).default('mine'),
  speciesId: z.string().uuid().optional(),
  pashuAadhaar: z.string().regex(/^\d{12}$/).optional(), // PC-54 W54-4 ear-tag/INAPH lookup
  status: z.enum(ANIMAL_STATUSES as unknown as [string, ...string[]]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryAnimalsDto = z.infer<typeof QueryAnimalsSchema>;
