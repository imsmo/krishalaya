// modules/tenant-integrations/dto/connect-integration.dto.ts · zod .strict() DTOs — PC-56 TENANT-13c. The wire shape only; every rule a
// person can break (ownable provider, credential fields per provider, kind vs the current connection, reason length, a second admin) is
// judged by the service's `judge` so the review and the write refuse with the SAME codes. `credential` is the raw provider secret: it is
// verified in shadow, sealed onto the proposal row, and vaulted only after the second verification — NEVER persisted in clear, logged,
// audited or echoed. `config` is NON-SECRET settings only, bounded.
import { z } from 'zod';

const CODE = z.string().trim().regex(/^[a-z][a-z0-9_]{1,59}$/);
const CREDENTIAL = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,30}$/), z.string().max(600)).refine((o) => Object.keys(o).length <= 8, 'at most 8 fields');
const CONFIG = z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()])).refine((o) => Object.keys(o).length <= 20, 'at most 20 keys');

export const ProposeIntegrationSchema = z.object({
  providerCode: CODE,
  kind: z.enum(['connect', 'rotate', 'disconnect']),
  credential: CREDENTIAL.optional(),
  config: CONFIG.optional(),
  reason: z.string().max(600),
}).strict();
export type ProposeIntegrationDto = z.infer<typeof ProposeIntegrationSchema>;

export const PreviewIntegrationSchema = ProposeIntegrationSchema.partial().strict();
export type PreviewIntegrationDto = z.infer<typeof PreviewIntegrationSchema>;

export const RefuseSchema = z.object({ reason: z.string().max(600) }).strict();
export type RefuseDto = z.infer<typeof RefuseSchema>;

export const QueryProposalsSchema = z.object({
  status: z.enum(['open', 'proposed', 'confirmed', 'applied', 'verify_failed', 'refused', 'expired']).optional(),
  providerCode: CODE.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type QueryProposalsDto = z.infer<typeof QueryProposalsSchema>;
