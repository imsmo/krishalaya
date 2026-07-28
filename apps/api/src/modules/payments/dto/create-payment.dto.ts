// modules/payments/dto/create-payment.dto.ts · zod .strict() (rejects unknown keys → no
// mass-assignment). Money is a string of minor units (bigint-safe over JSON).
import { z } from 'zod';

const minorUnits = z.string().regex(/^[1-9]\d{0,15}$/, 'amountMinor must be a positive integer string of minor units');

export const CreatePaymentIntentSchema = z.object({
  purpose: z.enum(['wallet_recharge', 'direct_order', 'subscription', 'boost', 'emd', 'course', 'insurance_premium']),
  amountMinor: minorUnits,
  currencyCode: z.string().length(3).default('INR'),
  referenceType: z.string().max(50).optional(),
  referenceId: z.string().uuid().optional(),
}).strict();
export type CreatePaymentIntentDto = z.infer<typeof CreatePaymentIntentSchema>;

export const RefundPaymentSchema = z.object({
  amountMinor: minorUnits,                 // partial or full (must be ≤ refundable)
  reason: z.string().max(280).optional(),
}).strict();
export type RefundPaymentDto = z.infer<typeof RefundPaymentSchema>;
