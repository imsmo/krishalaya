import { z } from 'zod';
// vaultRef is the tokenised fund-account id from the payment gateway. The raw account
// number / VPA is tokenised at the gateway and NEVER sent here in the clear at rest.
export const CreateBankAccountSchema = z.object({
  accountKind: z.enum(['bank','upi']),
  upiId: z.string().max(100).optional(),
  accountLast4: z.string().regex(/^\d{4}$/).optional(),
  ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/).optional(),
  holderName: z.string().max(200).optional(),
  vaultRef: z.string().min(4).max(200),
  isPrimary: z.boolean().prefault(false),
}).strict();
export type CreateBankAccountDto = z.infer<typeof CreateBankAccountSchema>;
