// modules/fintech/dto/create-loan-repayment.dto.ts · zod .strict() repayment payload.
import { z } from 'zod';
const minorStr = z.string().regex(/^\d{1,15}$/, 'must be a positive integer (minor units)');
export const RepayLoanSchema = z.object({
  amountMinor: minorStr,
  channel: z.enum(['upi', 'milk_bill_deduction', 'harvest_settlement', 'cash_partner', 'wallet']).prefault('wallet'),
}).strict();
export type RepayLoanDto = z.infer<typeof RepayLoanSchema>;
