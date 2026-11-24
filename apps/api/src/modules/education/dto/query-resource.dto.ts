// modules/education/dto/query-resource.dto.ts · zod .strict() — browse resources (keyset).
import { z } from 'zod';
import { RESOURCE_KINDS, RESOURCE_STATUSES } from '../domain/creator.events';
export const QueryResourcesSchema = z.object({
  box: z.enum(['browse', 'mine', 'all']).prefault('browse'),   // browse=approved; mine=own; all=moderator
  channelId: z.string().uuid().optional(),
  kind: z.enum(RESOURCE_KINDS as unknown as [string, ...string[]]).optional(),
  topicId: z.string().uuid().optional(),
  status: z.enum(RESOURCE_STATUSES as unknown as [string, ...string[]]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryResourcesDto = z.infer<typeof QueryResourcesSchema>;
