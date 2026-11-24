// modules/disputes/dto/query-dispute-message.dto.ts · list a dispute's messages (cursor pagination).
import { z } from 'zod';
export const QueryDisputeMessagesSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryDisputeMessagesDto = z.infer<typeof QueryDisputeMessagesSchema>;
