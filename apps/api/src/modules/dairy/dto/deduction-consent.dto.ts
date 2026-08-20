// modules/dairy/dto/deduction-consent.dto.ts · PC-56 TENANT-6c-4 · W169's 25% rule, as a request body.
import { z } from 'zod';

/**
 * THE FIGURES ARE NOT IN THIS BODY, deliberately.
 *
 * A client-supplied gross or deduction total would be a consent to numbers the member may never have seen — and the
 * one thing this record exists to prove is WHICH figures were agreed to. They are read from the bill inside the
 * transaction and written onto the consent row there.
 *
 * `channel` is 0003's own consent-channel vocabulary, reused verbatim rather than re-invented: a farmer with no
 * smartphone consents through an ambassador sitting beside her or over an IVR call, and a platform that only accepts
 * `app` has excluded the people it exists for.
 */
export const RecordDeductionConsentSchema = z.object({
  granted: z.boolean(),
  channel: z.enum(['app', 'web', 'ambassador_assisted', 'ivr']),
  /** Required by the database exactly when the channel is `ambassador_assisted` — an assisted consent names who assisted. */
  assistedBy: z.string().uuid().optional(),
  note: z.string().max(500).optional(),
}).strict();
export type RecordDeductionConsentDto = z.infer<typeof RecordDeductionConsentSchema>;
