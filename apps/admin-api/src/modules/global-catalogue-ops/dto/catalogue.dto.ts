// apps/admin-api/src/modules/global-catalogue-ops/dto/catalogue.dto.ts · zod .strict() request schemas (reject
// unknown keys → no mass-assignment). Every mutation carries a mandatory reason. Codes/slugs are charset-bounded
// here AND re-validated in the domain (defence in depth); `meta` is bounded; lists are keyset-paged + capped.
import { z } from 'zod';
import { COMMERCE_KINDS } from '../domain/category-tree';

const Reason = z.string().min(3).max(1000);
const Cursor = z.string().max(200).optional();
const Limit = z.coerce.number().int().min(1).max(100).prefault(50);
const TypeCode = z.string().min(2).max(60).regex(/^[a-z][a-z0-9_]{1,59}$/);
const ValueCode = z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9_.-]{0,79}$/);
const Slug = z.string().min(1).max(40).regex(/^[a-z0-9_]{1,40}$/);
const Name = z.string().min(1).max(150);
const SortOrder = z.coerce.number().int().min(0).max(32767);
const MetaPrimitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const Meta = z.record(z.string(), z.union([MetaPrimitive, z.array(MetaPrimitive)]));
const Uuid = z.string().uuid();

/* ---------------- lookup types ---------------- */
export const CreateLookupTypeSchema = z.object({
  code: TypeCode,
  defaultName: Name.max(100),
  isTenantExtendable: z.boolean().prefault(false),
  reason: Reason,
}).strict();
export type CreateLookupTypeDto = z.infer<typeof CreateLookupTypeSchema>;

export const UpdateLookupTypeSchema = z.object({ defaultName: Name.max(100), reason: Reason }).strict();
export type UpdateLookupTypeDto = z.infer<typeof UpdateLookupTypeSchema>;

/* ---------------- lookup values (platform) ---------------- */
export const CreateLookupValueSchema = z.object({
  typeCode: TypeCode,
  code: ValueCode,
  defaultName: Name,
  meta: Meta.prefault({}),
  sortOrder: SortOrder.prefault(100),
  reason: Reason,
}).strict();
export type CreateLookupValueDto = z.infer<typeof CreateLookupValueSchema>;

export const UpdateLookupValueSchema = z.object({
  defaultName: Name.optional(),
  meta: Meta.optional(),
  sortOrder: SortOrder.optional(),
  reason: Reason,
}).strict().refine((d) => d.defaultName !== undefined || d.meta !== undefined || d.sortOrder !== undefined, { message: 'at least one of defaultName/meta/sortOrder is required' });
export type UpdateLookupValueDto = z.infer<typeof UpdateLookupValueSchema>;

export const SetActiveSchema = z.object({ isActive: z.boolean(), reason: Reason }).strict();
export type SetActiveDto = z.infer<typeof SetActiveSchema>;

/* ---------------- categories ---------------- */
export const CreateCategorySchema = z.object({
  parentId: Uuid.nullable().optional(),
  slug: Slug,
  defaultName: Name,
  commerceKind: z.enum(COMMERCE_KINDS).prefault('goods'),
  requiresLicense: z.boolean().prefault(false),
  requiresCertificate: z.boolean().prefault(false),
  minAge: z.coerce.number().int().min(0).max(120).nullable().optional(),
  sortOrder: SortOrder.prefault(100),
  iconMediaId: Uuid.nullable().optional(),
  reason: Reason,
}).strict();
export type CreateCategoryDto = z.infer<typeof CreateCategorySchema>;

export const UpdateCategorySchema = z.object({
  defaultName: Name.optional(),
  commerceKind: z.enum(COMMERCE_KINDS).optional(),
  requiresLicense: z.boolean().optional(),
  requiresCertificate: z.boolean().optional(),
  minAge: z.coerce.number().int().min(0).max(120).nullable().optional(),
  sortOrder: SortOrder.optional(),
  iconMediaId: Uuid.nullable().optional(),
  reason: Reason,
}).strict().refine(
  (d) => ['defaultName', 'commerceKind', 'requiresLicense', 'requiresCertificate', 'minAge', 'sortOrder', 'iconMediaId'].some((k) => (d as Record<string, unknown>)[k] !== undefined),
  { message: 'at least one mutable field is required' });
export type UpdateCategoryDto = z.infer<typeof UpdateCategorySchema>;

export const MoveCategorySchema = z.object({ newParentId: Uuid.nullable(), reason: Reason }).strict();
export type MoveCategoryDto = z.infer<typeof MoveCategorySchema>;

/* ---------------- queries ---------------- */
export const QueryLookupTypesSchema = z.object({ cursor: Cursor, limit: Limit }).strict();
export type QueryLookupTypesDto = z.infer<typeof QueryLookupTypesSchema>;

export const QueryLookupValuesSchema = z.object({
  typeCode: TypeCode,
  isActive: z.enum(['true', 'false']).optional(),
  cursor: Cursor,
  limit: Limit,
}).strict();
export type QueryLookupValuesDto = z.infer<typeof QueryLookupValuesSchema>;

export const QueryCategoriesSchema = z.object({
  parentId: Uuid.optional(),
  isActive: z.enum(['true', 'false']).optional(),
  commerceKind: z.enum(COMMERCE_KINDS).optional(),
  cursor: Cursor,
  limit: Limit,
}).strict();
export type QueryCategoriesDto = z.infer<typeof QueryCategoriesSchema>;

export const QueryChangesSchema = z.object({ cursor: Cursor, limit: Limit }).strict();
export type QueryChangesDto = z.infer<typeof QueryChangesSchema>;
