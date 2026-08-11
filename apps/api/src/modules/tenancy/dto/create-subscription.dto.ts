// modules/tenancy/dto/create-subscription.dto.ts · zod .strict() subscribe / change-plan payloads.
import { z } from 'zod';
import { BILLING_CYCLES } from '../domain/tenancy.events';
export const SubscribeSchema = z.object({
  planId: z.string().uuid(),
  billingCycle: z.enum(BILLING_CYCLES as unknown as [string, ...string[]]).default('monthly'),
}).strict();
export type SubscribeDto = z.infer<typeof SubscribeSchema>;

// **NO AMOUNT IS ACCEPTED HERE, EVER.** A client that could post the amount due could post a smaller one; the service
// recomputes every figure from the plans, the period and the tax setting. `reason` is the tenant's own words, kept because
// a scheduled downgrade with no reason on it is an unpleasant surprise on the first of the month (0126's own note).
export const ChangePlanSchema = z.object({ planId: z.string().uuid(), reason: z.string().trim().max(300).optional() }).strict();
export type ChangePlanDto = z.infer<typeof ChangePlanSchema>;

export const CancelSubscriptionSchema = z.object({ atPeriodEnd: z.boolean().default(false) }).strict();
export type CancelSubscriptionDto = z.infer<typeof CancelSubscriptionSchema>;
