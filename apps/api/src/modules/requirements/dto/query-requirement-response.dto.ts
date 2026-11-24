// modules/requirements/dto/query-requirement-response.dto.ts · list quotes on a requirement (cursor pagination).
import { z } from 'zod';
import { RESPONSE_STATUSES } from '../domain/requirement-response.state';

export const QueryResponsesSchema = z.object({
  status: z.enum(RESPONSE_STATUSES).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(20),
}).strict();
export type QueryResponsesDto = z.infer<typeof QueryResponsesSchema>;
