// modules/communication/dto/query-message.dto.ts · zod .strict() — list a conversation's messages (keyset).
import { z } from 'zod';
export const QueryMessagesSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryMessagesDto = z.infer<typeof QueryMessagesSchema>;
