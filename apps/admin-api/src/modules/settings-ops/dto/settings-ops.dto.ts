// apps/admin-api/src/modules/settings-ops/dto/settings-ops.dto.ts · PC-56 ADMIN-11. All `.strict()`.
import { z } from 'zod';

/** Twenty characters. A platform setting change reaches every tenant that has not overridden it — W103's own audit note
 *  reads "ripples to all 2,847 tenants" — and a three-word reason on a change that size is a decision nobody wrote down. */
const Reason = z.string().trim().min(20).max(2_000);
const Key = z.string().trim().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/).max(80);
const ValueType = z.enum(['string', 'int', 'decimal', 'bool', 'json']);
const RiskClass = z.enum(['ordinary', 'money_path', 'security']);

export const QuerySettingsSchema = z.object({
  prefix: z.string().trim().max(60).optional(),
  riskClass: RiskClass.optional(),
  cursor: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
export type QuerySettingsDto = z.infer<typeof QuerySettingsSchema>;

export const DefineSettingSchema = z.object({
  key: Key,
  valueType: ValueType,
  // 'user' is accepted because `setting_definitions.scope` allows it; nothing on this platform reads a user-scoped
  // setting yet, and refusing the value here would mean the console could not describe a row the schema permits.
  scope: z.enum(['platform', 'tenant', 'user']).default('tenant'),
  riskClass: RiskClass.default('ordinary'),
  // `unknown` rather than a union: the value's shape is decided by `valueType` and validated in the domain, and a zod
  // union here would be a second, subtly different type system for the same field.
  //
  // **ZOD INFERS `z.unknown()` AS OPTIONAL AND NO REFINEMENT CHANGES THAT**, so the TYPE cannot express "present but of
  // any shape". Rather than fight it with a cast — which would make the type lie — the service takes it as optional and
  // `assertValue` refuses `undefined` for all five value types with the message the operator needs ("this setting is a
  // whole number"). The check is a runtime refusal instead of a type-level fiction, which is the honest version.
  defaultValue: z.unknown(),
  description: z.string().trim().max(2_000).optional(),
  lockNote: z.string().trim().max(2_000).optional(),
  reason: Reason,
}).strict();
export type DefineSettingDto = z.infer<typeof DefineSettingSchema>;

export const SetSettingValueSchema = z.object({
  // Optional in the TYPE and required in FACT: see `defaultValue` above — `assertValue` refuses undefined for every
  // value type, so "set this setting" cannot arrive with nothing to set.
  value: z.unknown(),
  reason: Reason,
  /** The maker, on a money-path or security key. The CALLER is the approver, so this must be somebody else and the
   *  shared two-person helper says so. */
  proposedByAdminId: z.string().uuid().optional(),
}).strict();
export type SetSettingValueDto = z.infer<typeof SetSettingValueSchema>;

export const RevertSettingSchema = z.object({
  reason: Reason,
  proposedByAdminId: z.string().uuid().optional(),
}).strict();
export type RevertSettingDto = z.infer<typeof RevertSettingSchema>;

export const RetypeSettingSchema = z.object({
  valueType: ValueType,
  reason: Reason,
}).strict();
export type RetypeSettingDto = z.infer<typeof RetypeSettingSchema>;

export const ReclassifySettingSchema = z.object({
  riskClass: RiskClass,
  lockNote: z.string().trim().max(2_000).optional(),
  reason: Reason,
  proposedByAdminId: z.string().uuid().optional(),
}).strict();
export type ReclassifySettingDto = z.infer<typeof ReclassifySettingSchema>;
