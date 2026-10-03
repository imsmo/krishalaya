// modules/tenancy/dto/create-tenant-settings.dto.ts · tenant settings writes (zod .strict). `value` is an arbitrary JSON value here and
// is type-checked against the setting_definition (value_type + tenant scope) in the domain — fail closed on unknown keys, wrong types,
// or non-tenant scope. PC-56 TENANT-13b: an optional `reason` (ordinary keys — recorded with before/after, F-16); a PROPOSAL needs one
// (20–500, checked in the domain so the refusal names the field); confirm / refuse / languages.
import { z } from 'zod';
const KEY = z.string().trim().min(1).max(80).regex(/^[a-z0-9_.]+$/);
const VALUE = z.union([z.string(), z.number(), z.boolean(), z.record(z.unknown()), z.array(z.unknown())]);
export const PutTenantSettingSchema = z.object({
  key: KEY,
  value: VALUE,
  reason: z.string().max(600).optional().nullable(),
}).strict();
export type PutTenantSettingDto = z.infer<typeof PutTenantSettingSchema>;

/** W2755 review and the proposal itself share one shape. */
export const ProposeSettingSchema = PutTenantSettingSchema;
export type ProposeSettingDto = PutTenantSettingDto;

export const RefuseProposalSchema = z.object({ reason: z.string().max(600) }).strict();
export type RefuseProposalDto = z.infer<typeof RefuseProposalSchema>;

export const PutLanguagesSchema = z.object({
  enabled: z.array(z.string().trim().min(2).max(8)).min(1).max(20),
  primary: z.string().trim().min(2).max(8),
  reason: z.string().max(600).optional().nullable(),
}).strict();
export type PutLanguagesDto = z.infer<typeof PutLanguagesSchema>;
