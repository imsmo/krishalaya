// modules/catalogue/dto/create-attribute-option.dto.ts · CANONICAL write-contract for a global attribute option.
// (Law 11) global catalogue writes run in apps/admin-api; this is the single-sourced .strict input shape — not
// routed by a tenant controller here.
import { z } from 'zod';
export const CreateAttributeOptionSchema = z.object({
  attributeId: z.string().uuid(),
  code: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9_.-]{0,79}$/),
  defaultName: z.string().min(1).max(150),
  sortOrder: z.coerce.number().int().min(0).max(32767).prefault(100),
  isActive: z.boolean().prefault(true),
}).strict();
export type CreateAttributeOptionDto = z.infer<typeof CreateAttributeOptionSchema>;
