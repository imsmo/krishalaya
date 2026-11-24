// modules/identity/dto/submit-business-kyc.dto.ts · zod .strict() (rejects unknown keys → no mass-assignment).
// The RAW gstin/pan are accepted here ONCE, shape-validated, then MASKED in the domain before storage — they are
// NEVER persisted or logged raw (DPDP §4). GSTIN is optional (buyers below the GST threshold may have PAN only).
import { z } from 'zod';
import { BUSINESS_TYPES } from '../domain/business-kyc.rules';

export const SubmitBusinessKycSchema = z.object({
  businessType: z.enum(BUSINESS_TYPES as unknown as [string, ...string[]]),
  legalName: z.string().trim().min(2).max(200),
  gstin: z.string().trim().length(15).optional(),
  pan: z.string().trim().length(10),                         // PAN is mandatory for a business entity
  docMediaIds: z.array(z.string().uuid()).max(10).prefault([]),
}).strict();
export type SubmitBusinessKycDto = z.infer<typeof SubmitBusinessKycSchema>;

export const ReviewBusinessKycSchema = z.object({
  decision: z.enum(['verify', 'reject']),
  reason: z.string().max(500).optional(),
}).strict().refine((v) => v.decision !== 'reject' || (v.reason && v.reason.length > 0), { message: 'reason required when rejecting' });
export type ReviewBusinessKycDto = z.infer<typeof ReviewBusinessKycSchema>;
