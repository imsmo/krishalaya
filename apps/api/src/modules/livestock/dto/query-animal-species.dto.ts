// modules/livestock/dto/query-animal-species.dto.ts · zod .strict() species browse query.
import { z } from 'zod';
export const QuerySpeciesSchema = z.object({ activeOnly: z.coerce.boolean().prefault(true) }).strict();
export type QuerySpeciesDto = z.infer<typeof QuerySpeciesSchema>;
