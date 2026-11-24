// modules/traceability/dto/query-trace-event.dto.ts · zod .strict() — a lot's journey timeline (keyset, ascending).
import { z } from 'zod';
export const QueryEventsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryEventsDto = z.infer<typeof QueryEventsSchema>;
