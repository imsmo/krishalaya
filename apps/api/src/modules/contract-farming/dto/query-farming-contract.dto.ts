// modules/contract-farming/dto/query-farming-contract.dto.ts · zod .strict() contract list query (keyset).
import { z } from 'zod';
import { CONTRACT_STATUSES } from '../domain/farming-contract.state';
export const QueryContractsSchema = z.object({
  box: z.enum(['mine', 'all']).prefault('mine'),   // mine = contracts the caller is the buyer of
  status: z.enum(CONTRACT_STATUSES as unknown as [string, ...string[]]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryContractsDto = z.infer<typeof QueryContractsSchema>;
