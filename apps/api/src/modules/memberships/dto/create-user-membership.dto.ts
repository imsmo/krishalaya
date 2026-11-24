// modules/memberships/dto/create-user-membership.dto.ts · zod .strict() subscribe payload.
import { z } from 'zod';
import { BILLING_CYCLES } from '../domain/memberships.events';
export const SubscribeSchema = z.object({
  tierId: z.string().uuid(),
  billingCycle: z.enum(BILLING_CYCLES as unknown as [string, ...string[]]).prefault('monthly'),
}).strict();
export type SubscribeDto = z.infer<typeof SubscribeSchema>;
