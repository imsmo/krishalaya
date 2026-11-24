// apps/admin-api/src/modules/tenant-ops/dto/tenant-ops.dto.ts · zod .strict() request schemas (reject unknown
// keys → no mass-assignment). A god-mode mutation ALWAYS carries a reason (audit/§4). Limit values are bigint
// (-1=unlimited); accepted as an integer string OR int and validated, never floated.
import { z } from 'zod';
import { TENANT_STATUSES } from '../domain/tenant.state';

const Reason = z.string().min(3).max(500);

export const ApproveTenantSchema = z.object({ reason: Reason }).strict();
export type ApproveTenantDto = z.infer<typeof ApproveTenantSchema>;

export const SuspendTenantSchema = z.object({ reason: Reason }).strict();
export type SuspendTenantDto = z.infer<typeof SuspendTenantSchema>;

export const ArchiveTenantSchema = z.object({ reason: Reason }).strict();
export type ArchiveTenantDto = z.infer<typeof ArchiveTenantSchema>;

// limit_value: integer >= -1. Accept number or integer-string; reject floats/garbage. Stored as a string param.
const LimitValue = z.union([
  z.number().int().min(-1),
  z.string().regex(/^-1$|^\d{1,18}$/),
]).transform((v) => String(v));

export const OverrideLimitSchema = z.object({
  limitCode: z.string().regex(/^[a-z0-9_]{2,60}$/),
  limitValue: LimitValue,
  reason: Reason,
  expiresAt: z.string().datetime().nullish(),
}).strict();
export type OverrideLimitDto = z.infer<typeof OverrideLimitSchema>;

export const QueryTenantsSchema = z.object({
  q: z.string().max(80).optional(),                 // slug / display-name prefix
  status: z.enum(TENANT_STATUSES).optional(),
  riskMin: z.coerce.number().int().min(0).max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryTenantsDto = z.infer<typeof QueryTenantsSchema>;
