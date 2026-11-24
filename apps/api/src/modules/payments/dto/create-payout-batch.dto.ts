// modules/payments/dto/create-payout-batch.dto.ts · zod .strict() payout-batch run parameters.
// A batch is opened by the worker (settlement/wage/ambassador runs); these knobs bound a single run.
import { z } from 'zod';

export const CreatePayoutBatchSchema = z.object({
  batchType: z.string().min(1).max(40),
  /** Only claim payouts at or below this priority number (lower = more urgent). Null = all lanes. */
  maxPriority: z.number().int().min(0).max(32767).nullable().prefault(null),
  /** Upper bound on how many payouts this run disburses (back-pressure, Law 5). */
  limit: z.number().int().min(1).max(1000).prefault(200),
}).strict();
export type CreatePayoutBatchDto = z.infer<typeof CreatePayoutBatchSchema>;
