// apps/admin-api/src/modules/ledger-ops/dto/ledger-ops.dto.ts · zod .strict() (PC-56 ADMIN-6).
import { z } from 'zod';

const Cursor = z.string().max(200).optional();

export const QueryTxnsSchema = z.object({
  /** W064: "Date filters default today (partition pruning)". The window rule is enforced in the service so the
   *  refusal explains the partition reason rather than quoting a schema bound. */
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  txnType: z.string().regex(/^[a-z][a-z0-9_]{1,59}$/).optional(),
  tenantId: z.string().uuid().optional(),
  accountCode: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/).optional(),
  cursor: Cursor,
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type QueryTxnsDto = z.infer<typeof QueryTxnsSchema>;

/** W065's lookup accepts either a txn id or an idempotency key, because "retried operations share one txn" is the
 *  screen's own hint about how an operator finds one. */
export const FindTxnSchema = z.object({
  id: z.string().uuid().optional(),
  idempotencyKey: z.string().min(1).max(120).optional(),
}).strict();
export type FindTxnDto = z.infer<typeof FindTxnSchema>;

export const VerifyChainSchema = z.object({
  accountId: z.string().uuid(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
}).strict();
export type VerifyChainDto = z.infer<typeof VerifyChainSchema>;

export const QueryAccountsSchema = z.object({
  ownerKind: z.enum(['user', 'tenant']).optional(),
  frozenOnly: z.enum(['1', 'true']).optional(),
  cursor: Cursor,
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type QueryAccountsDto = z.infer<typeof QueryAccountsSchema>;
