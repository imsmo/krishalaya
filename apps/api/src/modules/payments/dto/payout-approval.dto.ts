// modules/payments/dto/payout-approval.dto.ts · W146's two writes (PC-56 TENANT-4b).
import { z } from 'zod';
import { NOTE_FLOOR } from '../domain/payout-approval';

/** The maker submits the EXECUTION INSTANT (ISO, with an offset). Not a wall-clock "18:00": a default local
 *  time in the backend is a hidden timezone assumption, and this platform ships to five countries by Y7.
 *  The cut-off is derived from the tenant's own setting, server-side. */
export const PreparePayoutBatchSchema = z.object({
  batchType: z.string().trim().min(1).max(40),
  executeAt: z.string().datetime({ offset: true }),
  /** Restrict the run to a lane (e.g. wages only, priority <= 10). Absent = every queued payout. */
  maxPriority: z.number().int().min(0).max(1000).nullish(),
}).strict();
export type PreparePayoutBatchDto = z.infer<typeof PreparePayoutBatchSchema>;

/** A rejection MUST carry its reason at the same 20-character floor as every other note in this programme
 *  (0139 refunds, 0141 charges) — and 0143's CHECK repeats it in the schema, asserting NOT NULL first,
 *  because a CHECK that evaluates to NULL passes. */
export const DecidePayoutBatchSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(2000).optional(),
}).strict().refine(
  (v) => v.decision !== 'rejected' || (v.note?.trim().length ?? 0) >= NOTE_FLOOR,
  { path: ['note'], message: `a rejection needs a reason of at least ${NOTE_FLOOR} characters` },
);
export type DecidePayoutBatchDto = z.infer<typeof DecidePayoutBatchSchema>;
