// modules/tenancy/dto/query-subscription.dto.ts · list subscriptions (cursor pagination).
import { z } from 'zod';
import { SUBSCRIPTION_STATUSES } from '../domain/subscription.state';
export const SUBSCRIPTION_BOXES = ['mine', 'all'] as const;   // all = platform admin view (plan.manage)
export const QuerySubscriptionsSchema = z.object({
  box: z.enum(SUBSCRIPTION_BOXES).prefault('mine'),
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(20),
}).strict();
export type QuerySubscriptionsDto = z.infer<typeof QuerySubscriptionsSchema>;
