// modules/catalogue/dto/create-category.dto.ts · CANONICAL write-contract for a global category-tree node.
// (Law 11) the category tree is WRITTEN in apps/admin-api (global-catalogue-ops) — this is the single-sourced
// .strict input shape mirrored here; the tenant API only browses categories + toggles tenant_categories.
import { z } from 'zod';
export const COMMERCE_KINDS = ['goods', 'livestock', 'service', 'rental', 'course', 'input_regulated'] as const;
export const CreateCategorySchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  slug: z.string().min(1).max(40).regex(/^[a-z0-9_]{1,40}$/),
  defaultName: z.string().min(1).max(150),
  commerceKind: z.enum(COMMERCE_KINDS).prefault('goods'),
  requiresLicense: z.boolean().prefault(false),
  requiresCertificate: z.boolean().prefault(false),
  minAge: z.coerce.number().int().min(0).max(120).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(32767).prefault(100),
  iconMediaId: z.string().uuid().nullable().optional(),
}).strict();
export type CreateCategoryDto = z.infer<typeof CreateCategorySchema>;
