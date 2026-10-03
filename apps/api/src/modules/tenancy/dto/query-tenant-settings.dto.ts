// modules/tenancy/dto/query-tenant-settings.dto.ts · reads of the settings plane (bounded; µs keyset cursors).
import { z } from 'zod';
export const QueryTenantSettingsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
}).strict();
export type QueryTenantSettingsDto = z.infer<typeof QueryTenantSettingsSchema>;

export const QueryProposalsSchema = z.object({
  status: z.enum(['proposed', 'confirmed', 'refused', 'expired', 'applied']).optional(),
  key: z.string().trim().max(80).regex(/^[a-z0-9_.]+$/).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type QueryProposalsDto = z.infer<typeof QueryProposalsSchema>;

export const QueryHistorySchema = z.object({
  key: z.string().trim().max(80).regex(/^[a-z0-9_.]+$/).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type QueryHistoryDto = z.infer<typeof QueryHistorySchema>;
