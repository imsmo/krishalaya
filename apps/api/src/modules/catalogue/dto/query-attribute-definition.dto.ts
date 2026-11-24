import { z } from 'zod';
export const QueryAttributesForCategorySchema = z.object({ categoryId: z.string().uuid(), filtersOnly: z.coerce.boolean().prefault(false) }).strict();
export type QueryAttributesForCategoryDto = z.infer<typeof QueryAttributesForCategorySchema>;
