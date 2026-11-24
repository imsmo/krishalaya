// modules/memberships/dto/query-user-membership.dto.ts · list memberships (cursor pagination).
import { z } from 'zod';
import { MEMBERSHIP_STATUSES } from '../domain/user-membership.state';
export const MEMBERSHIP_BOXES = ['mine', 'all'] as const;   // all = tenant admin view (needs membership.manage)
export const QueryMembershipsSchema = z.object({
  box: z.enum(MEMBERSHIP_BOXES).prefault('mine'),
  status: z.enum(MEMBERSHIP_STATUSES).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(20),
}).strict();
export type QueryMembershipsDto = z.infer<typeof QueryMembershipsSchema>;
