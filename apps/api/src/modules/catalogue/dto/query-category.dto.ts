import { z } from 'zod';
export const QueryCategorySchema = z.object({
  parentId: z.string().uuid().optional(),
  rootCode: z.string().max(80).optional(),
  activeOnly: z.coerce.boolean().prefault(true),
  enabledForTenant: z.coerce.boolean().prefault(false), // only categories this tenant has switched on
}).strict();
export type QueryCategoryDto = z.infer<typeof QueryCategorySchema>;

export const ToggleTenantCategorySchema = z.object({ categoryId: z.string().uuid(), isEnabled: z.boolean() }).strict();
export type ToggleTenantCategoryDto = z.infer<typeof ToggleTenantCategorySchema>;
