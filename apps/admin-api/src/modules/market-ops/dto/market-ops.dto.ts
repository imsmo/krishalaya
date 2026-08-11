// modules/market-ops/dto/market-ops.dto.ts · PC-56 ADMIN-SWEEP. All `.strict()`.
import { z } from 'zod';

/** Twenty characters. The note is shown to the ambassador who reported the price — it is coaching, not a verdict, and
 *  "wrong" teaches nobody anything. */
const Note = z.string().trim().min(20).max(300);

export const QueryPulseSchema = z.object({
  movers: z.coerce.number().int().min(1).max(50).default(10),
}).strict();
export type QueryPulseDto = z.infer<typeof QueryPulseSchema>;

export const QueryQuarantineSchema = z.object({
  includeDecided: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
export type QueryQuarantineDto = z.infer<typeof QueryQuarantineSchema>;

export const DecidePriceSchema = z.object({
  // The partition key is part of the identity, so the client sends it back rather than the server scanning for it.
  priceDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  decision: z.enum(['released', 'rejected']),
  note: Note,
}).strict();
export type DecidePriceDto = z.infer<typeof DecidePriceSchema>;
