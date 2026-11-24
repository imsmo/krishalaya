// modules/catalogue/dto/create-attribute-template.dto.ts · CANONICAL write-contract for a global attribute
// template (clonable preset). (Law 11) writes run in apps/admin-api; single-sourced .strict shape, not routed here.
import { z } from 'zod';
export const AttributeTemplateItemSchema = z.object({
  attributeId: z.string().uuid(),
  required: z.boolean().prefault(false),
  defaultValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  sortOrder: z.number().int().min(0).max(32767).optional(),
}).strict();
export const CreateAttributeTemplateSchema = z.object({
  code: z.string().min(1).max(80).regex(/^[a-z][a-z0-9_]{0,79}$/),
  defaultName: z.string().min(1).max(150),
  categoryId: z.string().uuid().nullable().optional(),
  payload: z.object({ items: z.array(AttributeTemplateItemSchema).max(200) }).strict(),
}).strict();
export type CreateAttributeTemplateDto = z.infer<typeof CreateAttributeTemplateSchema>;
