// modules/payments/dto/query-payout-batch.dto.ts · zod .strict() list params. Keyset pagination only
// (opaque base64 cursor; never OFFSET) + a bounded limit (Law 5). Reads run on the replica (CQRS).
import { z } from 'zod';

export const QueryPayoutBatchSchema = z.object({
  status: z.enum(['open', 'executing', 'executed', 'failed']).optional(),
  batchType: z.string().min(1).max(40).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(20),
}).strict();
export type QueryPayoutBatchDto = z.infer<typeof QueryPayoutBatchSchema>;

/** Decode the opaque keyset cursor `${createdAt}|${id}` (base64). Returns undefined on any garbage. */
export function decodePayoutBatchCursor(cursor?: string): { c: string; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const [c, id] = Buffer.from(cursor, 'base64').toString('utf8').split('|');
    if (!c || !id) return undefined;
    return { c, id };
  } catch { return undefined; }
}
