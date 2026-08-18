// modules/payments/dto/settlement-cycle.dto.ts · W147's close decision (PC-56 TENANT-4c).
import { z } from 'zod';
import { NOTE_FLOOR } from '../domain/settlement-cycle';

/** A rejection MUST carry its reason at the same 20-character floor as every other note in this programme
 *  (0139 refunds, 0141 charges, 0143 payout batches) — and 0144's CHECK repeats it in the schema, asserting
 *  NOT NULL first, because a CHECK that evaluates to NULL passes. */
export const DecideCycleCloseSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(2000).optional(),
}).strict().refine(
  (v) => v.decision !== 'rejected' || (v.note?.trim().length ?? 0) >= NOTE_FLOOR,
  { path: ['note'], message: `a rejected close needs a reason of at least ${NOTE_FLOOR} characters` },
);
export type DecideCycleCloseDto = z.infer<typeof DecideCycleCloseSchema>;
