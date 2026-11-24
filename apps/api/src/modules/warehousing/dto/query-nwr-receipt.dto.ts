// modules/warehousing/dto/query-nwr-receipt.dto.ts · zod .strict() NWR list query (keyset).
import { z } from 'zod';
import { NWR_STATUSES } from '../domain/nwr-receipt.state';
export const QueryNwrSchema = z.object({
  box: z.enum(['mine', 'all']).prefault('mine'),   // mine = receipts the caller holds
  status: z.enum(NWR_STATUSES as unknown as [string, ...string[]]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryNwrDto = z.infer<typeof QueryNwrSchema>;
