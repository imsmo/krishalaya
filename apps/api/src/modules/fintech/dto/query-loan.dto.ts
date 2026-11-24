// modules/fintech/dto/query-loan.dto.ts · zod .strict() loan list query (keyset).
import { z } from 'zod';
import { LOAN_STATUSES } from '../domain/loan.state';
export const QueryLoansSchema = z.object({
  box: z.enum(['mine', 'all']).prefault('mine'),   // mine=borrower's; all=admin
  status: z.enum(LOAN_STATUSES as unknown as [string, ...string[]]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryLoansDto = z.infer<typeof QueryLoansSchema>;
