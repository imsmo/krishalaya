// apps/admin-api/src/modules/flags-ops/dto/flags-ops.dto.ts · zod .strict() request schemas (reject unknown keys
// → no mass-assignment). Every consequential mutation carries a reason (audit/§4). The PATCH body is a
// DISCRIMINATED UNION on `action` so each action validates exactly its own fields (no loose optionals). Targeting
// arrays are bounded (abuse/DoS §4) and identifiers are charset-validated (ReDoS-safe linear regexes).
import { z } from 'zod';
import { MAX_TENANT_IDS, MAX_PLANS, MAX_COUNTRIES } from '../domain/rollout';

const Reason = z.string().min(3).max(1000);
const Cursor = z.string().max(200).optional();
const Limit = z.coerce.number().int().min(1).max(100).prefault(50);
const FlagKey = z.string().regex(/^[a-z][a-z0-9_.]{1,79}$/, 'key must match ^[a-z][a-z0-9_.]{1,79}$');
const RolloutPct = z.coerce.number().int().min(0).max(100);
const PlanCode = z.string().regex(/^[a-z0-9_]{1,40}$/);
const CountryCode = z.string().regex(/^[A-Z]{2}$/);

export const QueryFlagsSchema = z.object({
  prefix: z.string().regex(/^[a-z0-9_.]{1,80}$/).optional(),   // key-prefix filter (e.g. 'payments.')
  enabled: z.enum(['true', 'false']).optional(),
  cursor: Cursor,
  limit: Limit,
}).strict();
export type QueryFlagsDto = z.infer<typeof QueryFlagsSchema>;

export const QueryFlagHistorySchema = z.object({ cursor: Cursor, limit: Limit }).strict();
export type QueryFlagHistoryDto = z.infer<typeof QueryFlagHistorySchema>;

export const CreateFlagSchema = z.object({
  key: FlagKey,
  description: z.string().max(500).optional(),
  rolloutPct: RolloutPct.prefault(0),                          // default OFF / 0% (Law 10)
  tenantIds: z.array(z.string().uuid()).max(MAX_TENANT_IDS).prefault([]),
  plans: z.array(PlanCode).max(MAX_PLANS).prefault([]),
  countries: z.array(CountryCode).max(MAX_COUNTRIES).prefault([]),
  reason: Reason,
}).strict();
export type CreateFlagDto = z.infer<typeof CreateFlagSchema>;

// PATCH /flags/:key — exactly one action, exactly its fields.
export const UpdateFlagSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('enable'), reason: Reason }).strict(),
  z.object({ action: z.literal('disable'), reason: Reason }).strict(),
  z.object({ action: z.literal('set_rollout'), rolloutPct: RolloutPct, reason: Reason }).strict(),
  z.object({
    action: z.literal('set_targeting'),
    tenantIds: z.array(z.string().uuid()).max(MAX_TENANT_IDS).prefault([]),
    plans: z.array(PlanCode).max(MAX_PLANS).prefault([]),
    countries: z.array(CountryCode).max(MAX_COUNTRIES).prefault([]),
    reason: Reason,
  }).strict(),
  z.object({ action: z.literal('kill'), reason: Reason }).strict(),     // emergency kill-switch (Law 10)
  z.object({ action: z.literal('unlock'), reason: Reason }).strict(),
]);
export type UpdateFlagDto = z.infer<typeof UpdateFlagSchema>;
