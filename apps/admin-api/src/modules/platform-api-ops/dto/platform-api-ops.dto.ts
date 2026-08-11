// modules/platform-api-ops/dto/platform-api-ops.dto.ts · PC-56 ADMIN-11c. All `.strict()`.
import { z } from 'zod';

/** W106's revoke panel marks the reason field required with an asterisk, and its footer says "This action is recorded ·
 *  api_keys.revoked_at · tenant notified". Twenty characters, the same floor as the other platform planes: a revocation
 *  breaks a live integration and "unused" is not a record of a decision. */
const Reason = z.string().trim().min(20).max(300);
const Registry = z.enum(['tenant', 'partner']);

export const QueryKeysSchema = z.object({
  registry: Registry.optional(),
  revoked: z.coerce.boolean().optional(),
  cursor: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
export type QueryKeysDto = z.infer<typeof QueryKeysSchema>;

export const RevokeKeySchema = z.object({
  registry: Registry,
  reason: Reason,
}).strict();
export type RevokeKeyDto = z.infer<typeof RevokeKeySchema>;

export const QueryInboundSchema = z.object({
  providerCode: z.string().trim().max(60).optional(),
  failuresOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
export type QueryInboundDto = z.infer<typeof QueryInboundSchema>;

export const QueryCircuitHistorySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
export type QueryCircuitHistoryDto = z.infer<typeof QueryCircuitHistorySchema>;
