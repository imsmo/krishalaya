// modules/communication/dto/query-masked-call.dto.ts · zod .strict() — the caller's own call log (keyset).
import { z } from 'zod';
export const QueryMaskedCallsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryMaskedCallsDto = z.infer<typeof QueryMaskedCallsSchema>;
