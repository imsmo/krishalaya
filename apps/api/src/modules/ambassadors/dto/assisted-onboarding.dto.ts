// modules/ambassadors/dto/assisted-onboarding.dto.ts · zod .strict() ambassador-assisted farmer onboarding.
// The ambassador creates a farmer who can't self-register. DPDP REQUIRES recorded consent — at least one
// purpose must be granted (the service rejects otherwise). No PII beyond what user-create needs; the user is
// resolved/created idempotently by phone server-side.
import { z } from 'zod';
export const AssistedOnboardingSchema = z.object({
  phone: z.string().min(8).max(20),
  fullName: z.string().trim().min(1).max(200).optional(),
  languageCode: z.string().min(2).max(8).prefault('hi'),
  countryCode: z.string().length(2).prefault('IN'),
  regionId: z.string().uuid().optional(),
  consents: z.array(z.object({
    purposeCode: z.string().min(2).max(60),
    granted: z.boolean(),
  })).min(1).max(20),
}).strict();
export type AssistedOnboardingDto = z.infer<typeof AssistedOnboardingSchema>;
