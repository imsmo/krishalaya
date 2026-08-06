// apps/admin-api/src/modules/schemes-registry-ops/dto/schemes-registry.dto.ts · zod .strict() request schemas
// (reject unknown keys → no mass-assignment). Every mutation carries a mandatory reason. Shapes are bounded here
// AND re-validated in the domain (defence in depth). processing_fee_minor is a DIGIT STRING → bigint (never a
// float, Law 2). The JSON blobs are passed through (domain bounds + validates them).
import { z } from 'zod';
import { AUTHORITY_LEVELS } from '../domain/scheme-rules';

const Reason = z.string().min(3).max(1000);
const Cursor = z.string().max(200).optional();
const Limit = z.coerce.number().int().min(1).max(100).default(50);
const Uuid = z.string().uuid();
const Code = z.string().min(2).max(60).regex(/^[a-z][a-z0-9_]{1,59}$/);
const SchemeName = z.string().min(1).max(250);
const AuthorityName = z.string().min(1).max(200);
const FeeMinor = z.string().regex(/^\d{1,15}$/, 'minor units as a non-negative integer string');
const JsonObject = z.record(z.unknown());
const UuidArray = z.array(Uuid);
const MmDd = z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const Window = z.object({ opens: MmDd, closes: MmDd, season: z.string().regex(/^[a-z_]{1,20}$/).optional() }).strict();
const SourceUrl = z.string().max(400).url();

/* ---------------- authorities ---------------- */
export const CreateAuthoritySchema = z.object({
  defaultName: AuthorityName,
  level: z.enum(AUTHORITY_LEVELS),
  regionId: Uuid.nullable().optional(),
  reason: Reason,
}).strict();
export type CreateAuthorityDto = z.infer<typeof CreateAuthoritySchema>;

export const UpdateAuthoritySchema = z.object({
  defaultName: AuthorityName.optional(),
  level: z.enum(AUTHORITY_LEVELS).optional(),
  regionId: Uuid.nullable().optional(),
  reason: Reason,
}).strict().refine((d) => d.defaultName !== undefined || d.level !== undefined || d.regionId !== undefined, { message: 'at least one of defaultName/level/regionId is required' });
export type UpdateAuthorityDto = z.infer<typeof UpdateAuthoritySchema>;

/* ---------------- schemes ---------------- */
export const CreateSchemeSchema = z.object({
  code: Code,
  defaultName: SchemeName,
  authorityId: Uuid,
  categoryId: Uuid,
  benefitSummary: JsonObject,
  eligibilityRules: JsonObject,
  requiredDocTypeIds: UuidArray.default([]),
  applicationWindow: Window.nullable().optional(),
  applicableRegionIds: UuidArray.default([]),
  processingFeeMinor: FeeMinor.default('0'),
  sourceUrl: SourceUrl.nullable().optional(),
  reason: Reason,
}).strict();
export type CreateSchemeDto = z.infer<typeof CreateSchemeSchema>;

export const UpdateSchemeMetaSchema = z.object({
  defaultName: SchemeName.optional(),
  authorityId: Uuid.optional(),
  categoryId: Uuid.optional(),
  sourceUrl: SourceUrl.nullable().optional(),
  reason: Reason,
}).strict().refine((d) => ['defaultName', 'authorityId', 'categoryId', 'sourceUrl'].some((k) => (d as Record<string, unknown>)[k] !== undefined), { message: 'at least one mutable meta field is required' });
export type UpdateSchemeMetaDto = z.infer<typeof UpdateSchemeMetaSchema>;

export const UpdateSchemeRulesSchema = z.object({
  benefitSummary: JsonObject.optional(),
  eligibilityRules: JsonObject.optional(),
  requiredDocTypeIds: UuidArray.optional(),
  applicableRegionIds: UuidArray.optional(),
  processingFeeMinor: FeeMinor.optional(),
  reason: Reason,
}).strict().refine((d) => ['benefitSummary', 'eligibilityRules', 'requiredDocTypeIds', 'applicableRegionIds', 'processingFeeMinor'].some((k) => (d as Record<string, unknown>)[k] !== undefined), { message: 'at least one rule field is required' });
export type UpdateSchemeRulesDto = z.infer<typeof UpdateSchemeRulesSchema>;

export const SetWindowSchema = z.object({ applicationWindow: Window.nullable(), reason: Reason }).strict();
export type SetWindowDto = z.infer<typeof SetWindowSchema>;

export const SetActiveSchema = z.object({ isActive: z.boolean(), reason: Reason }).strict();
export type SetActiveDto = z.infer<typeof SetActiveSchema>;

/* ---------------- queries ---------------- */
export const QueryAuthoritiesSchema = z.object({ level: z.enum(AUTHORITY_LEVELS).optional(), cursor: Cursor, limit: Limit }).strict();
export type QueryAuthoritiesDto = z.infer<typeof QueryAuthoritiesSchema>;

export const QuerySchemesSchema = z.object({
  authorityId: Uuid.optional(),
  categoryId: Uuid.optional(),
  isActive: z.enum(['true', 'false']).optional(),
  cursor: Cursor,
  limit: Limit,
}).strict();
export type QuerySchemesDto = z.infer<typeof QuerySchemesSchema>;

export const QueryCalendarSchema = z.object({
  onDate: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).optional(),   // 'MM-DD'; default = today
  cursor: Cursor,
  limit: Limit,
}).strict();
export type QueryCalendarDto = z.infer<typeof QueryCalendarSchema>;

export const QueryChangesSchema = z.object({ cursor: Cursor, limit: Limit }).strict();
export type QueryChangesDto = z.infer<typeof QueryChangesSchema>;

/* ============================ the version plane (PC-56 ADMIN-4 / migration 0105) ============================ */

/** A draft edit. Every field optional (a draft is edited a field at a time) but `reason` is always required, and the
 *  refine below refuses a body that changes nothing — an empty patch would open a version whose only content is a
 *  reason, and a version history padded with those is a history nobody reads. */
export const SaveDraftSchema = z.object({
  benefitSummary: JsonObject.optional(),
  eligibilityRules: JsonObject.optional(),
  requiredDocTypeIds: UuidArray.optional(),
  applicableRegionIds: UuidArray.optional(),
  // NULLABLE and optional are different requests: `null` clears the window (an always-open scheme), absent leaves it.
  applicationWindow: Window.nullable().optional(),
  processingFeeMinor: FeeMinor.optional(),
  reason: Reason,
}).strict().refine(
  (v) => v.benefitSummary !== undefined || v.eligibilityRules !== undefined || v.requiredDocTypeIds !== undefined
      || v.applicableRegionIds !== undefined || v.applicationWindow !== undefined || v.processingFeeMinor !== undefined,
  { message: 'a draft edit must change at least one versioned field' },
);
export type SaveDraftDto = z.infer<typeof SaveDraftSchema>;

/** Publishing. `checkerNote` is OPTIONAL on purpose: a checker who agrees has nothing to add, and a mandatory note
 *  teaches people to type 'ok' — which is worse than no note, because it looks like review. There is no `reason`
 *  here either; the change already has one, written by the maker, and the checker's job is to agree with it or not. */
export const PublishVersionSchema = z.object({
  versionId: Uuid,
  checkerNote: z.string().min(1).max(1000).optional(),
}).strict();
export type PublishVersionDto = z.infer<typeof PublishVersionSchema>;

export const DiscardDraftSchema = z.object({ versionId: Uuid, reason: Reason }).strict();
export type DiscardDraftDto = z.infer<typeof DiscardDraftSchema>;

export const QueryVersionsSchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).strict();
export type QueryVersionsDto = z.infer<typeof QueryVersionsSchema>;

/* ============================ DELTA-018: authority portal mapping ============================ */

/** `providerCode` is validated against a CLOSED LIST in the service (not here) so the 422 can explain that a portal
 *  must be a registered integration provider rather than free text — `external_entity_refs.provider_code` is an FK
 *  and a typo would fail as a foreign-key violation, which tells an operator nothing. */
export const MapPortalSchema = z.object({
  providerCode: z.string().min(2).max(60),
  externalId: z.string().min(1).max(200),
  endpointLabel: z.string().min(1).max(200).nullable().optional(),
  reason: Reason,
}).strict();
export type MapPortalDto = z.infer<typeof MapPortalSchema>;

export const UnmapPortalSchema = z.object({ providerCode: z.string().min(2).max(60), reason: Reason }).strict();
export type UnmapPortalDto = z.infer<typeof UnmapPortalSchema>;

/* ============================ exports (W2251 / W2252) ============================ */

/** No date window — see domain/scheme-export.ts NO_DATE_WINDOW_REASON. `report` is a plain string rather than an
 *  enum so the service can answer "applications" and "dbt" with the REASON they are refused instead of a generic
 *  "unknown report", which would send an operator hunting for a typo. */
export const SchemeExportSchema = z.object({
  report: z.string().min(1).max(40),
  limit: z.coerce.number().int().min(1).max(20000).optional(),
}).strict();
export type SchemeExportDto = z.infer<typeof SchemeExportSchema>;
