// modules/catalogue/dto/create-attribute-definition.dto.ts · CANONICAL write-contract for a global attribute
// definition. NOTE (Law 11): global catalogue WRITES are performed in apps/admin-api, not the tenant API — this
// schema is the single-sourced input shape (validated, .strict) the admin write path binds to; it is NOT routed
// by a tenant-facing controller here. Kept beside the read engine so the shape is defined once.
import { z } from 'zod';
export const DATA_TYPES = ['text', 'number', 'decimal', 'bool', 'date', 'option', 'multi_option', 'range', 'file'] as const;
export const AttributeValidationSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  regex: z.string().max(500).optional(),
  maxLen: z.number().int().min(1).max(100000).optional(),
}).strict();
export const CreateAttributeDefinitionSchema = z.object({
  code: z.string().min(1).max(80).regex(/^[a-z][a-z0-9_]{0,79}$/),
  defaultName: z.string().min(1).max(150),
  dataType: z.enum(DATA_TYPES),
  unitCode: z.string().max(20).nullable().optional(),
  validation: AttributeValidationSchema.prefault({}),
  isActive: z.boolean().prefault(true),
}).strict();
export type CreateAttributeDefinitionDto = z.infer<typeof CreateAttributeDefinitionSchema>;
