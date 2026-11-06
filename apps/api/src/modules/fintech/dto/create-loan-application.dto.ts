// modules/fintech/dto/create-loan-application.dto.ts · zod .strict() apply + lifecycle payloads.
// amounts are bigint minor-unit strings (Law 2). Approval opens an anti-predatory cooling-off window.
import { z } from 'zod';
const minorStr = z.string().regex(/^\d{1,15}$/, 'must be a positive integer (minor units)');
export const ApplyLoanSchema = z.object({
  productId: z.string().uuid(),
  amountRequestedMinor: minorStr,
  purposeText: z.string().max(300).optional(),
  nwrId: z.string().uuid().optional(),   // PC-56 OPS-2b · B8: accepted by the schema ONLY so the service can refuse it BY NAME (LOAN_ENWR_PLEDGE_NOT_ON_PLATFORM)
}).strict();
export type ApplyLoanDto = z.infer<typeof ApplyLoanSchema>;

export const ApproveLoanSchema = z.object({
  amountApprovedMinor: minorStr,
  coolingOffHours: z.number().int().min(0).max(720).default(24),   // PRD §59.4 — 24h default anti-predatory window
}).strict();
export type ApproveLoanDto = z.infer<typeof ApproveLoanSchema>;

export const RejectLoanSchema = z.object({ note: z.string().max(500).optional() }).strict();
export type RejectLoanDto = z.infer<typeof RejectLoanSchema>;
