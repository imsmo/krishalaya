// apps/admin-api/src/modules/providers-ops/dto/providers-ops.dto.ts · zod .strict() request schemas (reject unknown
// keys → no mass-assignment). The one mutation (toggle) carries a mandatory reason. No secret material is ever
// accepted or returned — providers-ops manages the registry + credential-ref HEALTH, never credentials.
import { z } from 'zod';
import { PROVIDER_CATEGORIES } from '../domain/category';

const Reason = z.string().min(3).max(1000);
const Cursor = z.string().max(200).optional();
const Limit = z.coerce.number().int().min(1).max(100).prefault(50);

export const QueryProvidersSchema = z.object({
  category: z.enum(PROVIDER_CATEGORIES).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  cursor: Cursor,
  limit: Limit,
}).strict();
export type QueryProvidersDto = z.infer<typeof QueryProvidersSchema>;

export const QueryChangesSchema = z.object({ cursor: Cursor, limit: Limit }).strict();
export type QueryChangesDto = z.infer<typeof QueryChangesSchema>;

export const ToggleProviderSchema = z.object({
  action: z.enum(['enable', 'disable']),
  reason: Reason,
}).strict();
export type ToggleProviderDto = z.infer<typeof ToggleProviderSchema>;
