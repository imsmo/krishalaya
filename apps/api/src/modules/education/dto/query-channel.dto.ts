// modules/education/dto/query-channel.dto.ts · zod .strict() — list channels (keyset).
import { z } from 'zod';
import { CHANNEL_STATUSES } from '../domain/creator.events';
export const QueryChannelsSchema = z.object({
  box: z.enum(['browse', 'mine', 'all']).prefault('browse'),   // browse=approved; mine=own; all=moderator
  status: z.enum(CHANNEL_STATUSES as unknown as [string, ...string[]]).optional(),
  topicId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryChannelsDto = z.infer<typeof QueryChannelsSchema>;
