import { z } from 'zod';
export const GrantConsentSchema = z.object({
  purposeCode: z.string().min(2).max(60),
  granted: z.boolean(),
  channel: z.enum(['app','web','ambassador_assisted','ivr']).prefault('app'),
  assistedBy: z.string().uuid().optional(),
}).strict();
export type GrantConsentDto = z.infer<typeof GrantConsentSchema>;
