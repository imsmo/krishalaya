// modules/dairy/dto/create-milk-bill.dto.ts · zod .strict() bill generation + deduction payloads.
import { z } from 'zod';
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const minorStr = z.string().regex(/^\d{1,15}$/);

/**
 * [PC-56 TENANT-6c-4] A DEDUCTION LINE NOW HAS TO SAY WHAT IT PAYS.
 *
 * It used to be `{ type: z.string().min(1).max(40), amountMinor }` — any forty characters, referencing nothing. So
 * `{"type":"loan_emi","amount_minor":"30000"}` was a valid instruction to take ₹300 out of a family's milk money while
 * naming no loan, and nothing downstream could reduce anything or ever explain the shortfall to the member.
 *
 * `type` is now validated against the `milk_deduction` vocabulary (0160, `lookup_values`) inside the transaction, and
 * `sourceId` is the row the line settles — the member's feed credit, the member's loan. Which of those a type expects
 * comes from the vocabulary row itself (`meta.source_type`), so the DTO does not need a second copy of that mapping.
 */
export const DeductionLineSchema = z.object({
  type: z.string().min(1).max(40),
  amountMinor: minorStr,
  sourceId: z.string().uuid(),
}).strict();

export const GenerateBillSchema = z.object({
  membershipId: z.string().uuid(),
  periodStart: dateStr,
  periodEnd: dateStr,
  deductions: z.array(DeductionLineSchema).max(20).default([]),
}).strict();
export type GenerateBillDto = z.infer<typeof GenerateBillSchema>;
