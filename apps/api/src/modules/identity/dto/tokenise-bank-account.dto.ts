import { z } from 'zod';
// P1-16 · add a FULL bank account: the raw account number + IFSC are sent ONCE, tokenised at the gateway
// server-side, and ONLY the vault ref + last-4 are persisted (Law: never store raw bank). The raw number is
// transient (adapter-only) and never logged. The pre-tokenised path (vaultRef supplied by the client, e.g. UPI)
// stays in create-bank-account.dto.ts.
export const TokeniseBankAccountSchema = z.object({
  accountNumber: z.string().regex(/^\d{9,18}$/),               // RAW — tokenised server-side, never persisted/logged
  ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/),
  holderName: z.string().min(2).max(200),
  isPrimary: z.boolean().prefault(false),
}).strict();
export type TokeniseBankAccountDto = z.infer<typeof TokeniseBankAccountSchema>;
