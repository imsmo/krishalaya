// apps/admin-api/src/modules/catalogue-depth/dto/catalogue-depth.dto.ts · zod .strict() (PC-56 ADMIN-3).
//
// A `reason` IS MANDATORY ON EVERY MUTATION IN THIS FILE. That is the standard `global-catalogue-ops` has always held
// for the same domain, and its absence in this module — which touches unit conversion factors — was the defect ADMIN-3
// set out to fix. It is required here in the schema, not merely encouraged in a service, so no route can be added later
// that forgets it.
import { z } from 'zod';

/** The audit reason. 10 characters minimum: "fix" is not a reason anybody can act on six months later. */
const Reason = z.string().min(10).max(1000);
const Code = z.string().min(2).max(64);

export const QueryAttributesSchema = z.object({
  q: z.string().max(120).optional(),
  dataType: z.string().max(20).optional(),
  withUnit: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
}).strict();
export type QueryAttributesDto = z.infer<typeof QueryAttributesSchema>;

/** `validation` arrives as a STRING, not a parsed object, so the domain can refuse malformed JSON with the syntax error
 *  in its message rather than zod rejecting the whole body with "expected object". */
export const CreateAttributeSchema = z.object({
  code: Code,
  defaultName: z.string().min(2).max(150),
  dataType: z.enum(['text', 'number', 'decimal', 'bool', 'date', 'option', 'multi_option', 'range', 'file']),
  unitCode: z.string().max(20).nullish(),
  validation: z.string().max(4000).nullish(),
  reason: Reason,
}).strict();
export type CreateAttributeDto = z.infer<typeof CreateAttributeSchema>;

/** Every field optional EXCEPT the reason — a PATCH that says nothing is a no-op, and a PATCH with no reason is an
 *  unattributable change to something 61,204 listings depend on.
 *
 *  `acknowledgeConsequences` is the checker gate. It is not a permission: the caller has already passed
 *  catalogue.manage. It is an assertion that they have READ what the change does to existing data. */
export const UpdateAttributeSchema = z.object({
  defaultName: z.string().min(2).max(150).optional(),
  dataType: z.enum(['text', 'number', 'decimal', 'bool', 'date', 'option', 'multi_option', 'range', 'file']).optional(),
  unitCode: z.string().max(20).nullish(),
  validation: z.string().max(4000).nullish(),
  acknowledgeConsequences: z.boolean().optional(),
  reason: Reason,
}).strict();
export type UpdateAttributeDto = z.infer<typeof UpdateAttributeSchema>;

export const SetActiveSchema = z.object({ isActive: z.boolean(), reason: Reason }).strict();
export type SetActiveDto = z.infer<typeof SetActiveSchema>;

export const CreateOptionSchema = z.object({
  code: Code,
  defaultName: z.string().min(1).max(150),
  sortOrder: z.coerce.number().int().min(0).max(32767).optional(),
  // null / absent = the shared set. Set = narrowed to that branch (0102's DELTA-009 closure).
  categoryId: z.string().uuid().nullish(),
  reason: Reason,
}).strict();
export type CreateOptionDto = z.infer<typeof CreateOptionSchema>;

/** No `code` and no `categoryId`: changing either would silently move which listings an option belongs to. A different
 *  scope is a different option. */
export const UpdateOptionSchema = z.object({
  defaultName: z.string().min(1).max(150).optional(),
  sortOrder: z.coerce.number().int().min(0).max(32767).optional(),
  reason: Reason,
}).strict();
export type UpdateOptionDto = z.infer<typeof UpdateOptionSchema>;

/** `condition` is a STRING for the same reason `validation` is. */
export const CreateBindingSchema = z.object({
  attributeId: z.string().uuid(),
  isRequired: z.boolean().optional(),
  showInFilters: z.boolean().optional(),
  showOnCard: z.boolean().optional(),
  condition: z.string().max(2000).nullish(),
  sortOrder: z.coerce.number().int().min(0).max(32767).optional(),
  reason: Reason,
}).strict();
export type CreateBindingDto = z.infer<typeof CreateBindingSchema>;

/** No `attributeId`: re-pointing a binding at a different attribute is an unbind and a bind, and conflating them would
 *  make the audit trail claim one row changed when two relationships did. */
export const UpdateBindingSchema = z.object({
  isRequired: z.boolean().optional(),
  showInFilters: z.boolean().optional(),
  showOnCard: z.boolean().optional(),
  condition: z.string().max(2000).nullish(),
  sortOrder: z.coerce.number().int().min(0).max(32767).optional(),
  reason: Reason,
}).strict();
export type UpdateBindingDto = z.infer<typeof UpdateBindingSchema>;

export const UnbindSchema = z.object({ reason: Reason }).strict();
export type UnbindDto = z.infer<typeof UnbindSchema>;

export const CreateUnitSchema = z.object({
  code: z.string().min(1).max(20),
  defaultName: z.string().min(1).max(60),
  unitClass: z.enum(['mass', 'volume', 'count', 'area', 'time', 'length']),
  reason: Reason,
}).strict();
export type CreateUnitDto = z.infer<typeof CreateUnitSchema>;

/** THE FACTOR IS A STRING. z.coerce.number() here would round-trip numeric(20,10) through a float, and 0.4 is not
 *  representable in binary — the acre↔bigha factor would arrive subtly wrong. Same reasoning as Law 2 for money,
 *  applied to quantities, for the same reason: somebody's 40 quintals is not ours to approximate. */
export const UpsertConversionSchema = z.object({
  fromUnit: z.string().min(1).max(20),
  toUnit: z.string().min(1).max(20),
  factor: z.string().regex(/^\d{1,10}(\.\d{1,10})?$/, 'factor must be a positive decimal with at most 10 decimal places'),
  reason: Reason,
}).strict();
export type UpsertConversionDto = z.infer<typeof UpsertConversionSchema>;
