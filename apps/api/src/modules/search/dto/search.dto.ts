// modules/search/dto/search.dto.ts · zod .strict() query for the unified cross-entity search.
import { z } from 'zod';

export const QuerySearchSchema = z.object({
  q: z.string().min(1).max(200),                 // free text (required — a search needs a term)
  types: z.string().max(120).optional(),         // csv of entity types (default: all); validated in domain.parseTypes
  cursor: z.string().max(400).optional(),        // opaque federated cursor (per-type)
  limit: z.coerce.number().int().min(1).max(50).prefault(20),
}).strict();
export type QuerySearchDto = z.infer<typeof QuerySearchSchema>;
