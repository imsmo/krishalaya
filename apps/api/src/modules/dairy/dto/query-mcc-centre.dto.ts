// modules/dairy/dto/query-mcc-centre.dto.ts · zod .strict() MCC list query (keyset pagination).
import { z } from 'zod';
export const QueryMccSchema = z.object({
  activeOnly: z.coerce.boolean().prefault(true),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryMccDto = z.infer<typeof QueryMccSchema>;
