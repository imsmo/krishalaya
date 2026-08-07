// apps/admin-api/src/modules/payout-ops/dto/payout-ops.dto.ts (PC-56 ADMIN-6b)
//
// NO MONEY FIELD IS ACCEPTED FROM A CLIENT ANYWHERE IN THIS MODULE, and that is the most important property of this
// file. The preflight verdict, the payable total and the batch count are all computed server-side: a client that could
// supply `pass: true` or a total would be supplying the very facts the two-person rule exists to establish. Same rule as
// ADMIN-5f computing value-at-stake server-side because it gates a maker-checker — except here the consequence of being
// wrong is money in somebody else's bank account.
import { z } from 'zod';
import { BATCH_STATUSES } from '../domain/batch-approval';
import { RUN_STATUSES } from '../domain/settlement-cycle';
import { RETURN_REASON_MIN } from '../domain/batch-approval';

const cursor = z.string().max(500).optional();
const limit = z.coerce.number().int().min(1).max(100).default(25);

export const QueryBatchesSchema = z.object({
  // The status filter is an ENUM rather than a free string, so a typo returns a 400 rather than an empty list. An
  // operator filtering for "aproved" and being shown "no batches" would conclude there were none awaiting them.
  status: z.enum(BATCH_STATUSES).optional(),
  batchType: z.string().min(1).max(40).optional(),
  tenantId: z.string().uuid().optional(),
  cursor,
  limit,
});
export type QueryBatchesDto = z.infer<typeof QueryBatchesSchema>;

export const QueryBatchLinesSchema = z.object({ cursor, limit });
export type QueryBatchLinesDto = z.infer<typeof QueryBatchLinesSchema>;

/** Approving takes NO BODY, deliberately.
 *
 *  There is nothing for the client to say. The batch is identified by the path, the approver by the token, the time by
 *  the database, and the preflight is re-run server-side. Every field a body could carry would be a field a forged
 *  request could carry, and the one thing this endpoint must not accept is a claim about what the checks found.
 */
export const ApproveBatchSchema = z.object({}).strict();
export type ApproveBatchDto = z.infer<typeof ApproveBatchSchema>;

export const ReturnBatchSchema = z.object({
  // The floor matches 0114's CHECK. Both exist: this one gives the operator a usable error, the constraint protects
  // every future caller. Shipping only the Zod rule is how the floor quietly becomes advisory.
  reason: z.string().trim().min(RETURN_REASON_MIN).max(2_000),
}).strict();
export type ReturnBatchDto = z.infer<typeof ReturnBatchSchema>;

const cycleDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a settlement cycle is a business day: YYYY-MM-DD');

export const QuerySettlementSchema = z.object({
  cycle: cycleDate.optional(),
  tenantId: z.string().uuid().optional(),
  cursor,
  limit,
});
export type QuerySettlementDto = z.infer<typeof QuerySettlementSchema>;

export const QueryRunsSchema = z.object({
  status: z.enum(RUN_STATUSES).optional(),
  cursor,
  limit,
});
export type QueryRunsDto = z.infer<typeof QueryRunsSchema>;

export const RequestCycleSchema = z.object({
  periodStart: cycleDate,
  periodEnd: cycleDate,
}).strict();
export type RequestCycleDto = z.infer<typeof RequestCycleSchema>;
