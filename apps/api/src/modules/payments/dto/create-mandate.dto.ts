// modules/payments/dto/create-mandate.dto.ts · zod .strict() (rejects unknown keys → no mass-assignment).
// The per-debit cap is a string of minor units (bigint-safe over JSON). The raw `vpa` is validated for shape
// here but is NEVER persisted raw nor logged — the domain masks it before storage (DPDP minimisation).
import { z } from 'zod';

const minorUnits = z.string().regex(/^[1-9]\d{0,15}$/, 'maxAmountMinor must be a positive integer string of minor units');

export const RegisterMandateSchema = z.object({
  vpa: z.string().regex(/^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z0-9.\-]{1,30}$/, 'vpa must look like handle@psp'),
  // 'insurance_premium' added DEV-25/KV-BL-057 (§8 FLAGGED — payments-module gap fix): the insurance
  // Wave-7 auto-debit THIN LINK (InsurancePolicyService.linkAutopayMandate) needs a real purpose value to
  // validate against; additive only, no existing mandate's purpose is affected.
  purpose: z.enum(['membership', 'loan_emi', 'general', 'insurance_premium']),
  maxAmountMinor: minorUnits,
  currencyCode: z.string().length(3).default('INR'),
  frequency: z.enum(['as_presented', 'daily', 'weekly', 'monthly']).default('as_presented'),
  validUntil: z.string().datetime().optional(),     // ISO; optional open-ended mandate
}).strict();
export type RegisterMandateDto = z.infer<typeof RegisterMandateSchema>;

export const CancelMandateSchema = z.object({
  reason: z.string().max(280).optional(),
}).strict();
export type CancelMandateDto = z.infer<typeof CancelMandateSchema>;

// Execute (collect) a capped debit against an active mandate. amountMinor is a bigint-safe minor-units string
// and must be ≤ the mandate's per-debit cap (the domain re-asserts this — the DTO only checks shape). The
// caller supplies an Idempotency-Key header, NOT a body field, so a replay never double-collects.
export const ExecuteMandateSchema = z.object({
  amountMinor: z.string().regex(/^[1-9]\d{0,15}$/, 'amountMinor must be a positive integer string of minor units'),
}).strict();
export type ExecuteMandateDto = z.infer<typeof ExecuteMandateSchema>;
