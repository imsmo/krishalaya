// modules/dairy/dto/query-milk-bill.dto.ts · zod .strict() bill list query (keyset pagination).
import { z } from 'zod';
import { BILL_STATUSES } from '../domain/milk-bill.state';
export const QueryBillsSchema = z.object({
  box: z.enum(['mine', 'all']).prefault('mine'),
  membershipId: z.string().uuid().optional(),
  status: z.enum(BILL_STATUSES as unknown as [string, ...string[]]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryBillsDto = z.infer<typeof QueryBillsSchema>;
