import { z } from 'zod';
import { ProductAttrSchema } from './dto-attr';
export const CreateProductSchema = z.object({
  categoryId: z.string().uuid(),
  defaultName: z.string().trim().min(2).max(200),
  code: z.string().max(100).optional(),
  brandId: z.string().uuid().optional(),
  defaultUnit: z.string().min(1).max(20),
  gstRatePct: z.number().min(0).max(100).optional(),
  hsnCode: z.string().max(12).optional(),
  isPerishable: z.boolean().prefault(false),
  shelfLifeDays: z.number().int().min(0).max(100000).optional(),
  attributes: z.array(ProductAttrSchema).max(50).optional(),
}).strict();
export type CreateProductDto = z.infer<typeof CreateProductSchema>;

export const UpdateProductSchema = z.object({
  categoryId: z.string().uuid().optional(),
  defaultName: z.string().trim().min(2).max(200).optional(),
  brandId: z.string().uuid().optional(),
  defaultUnit: z.string().min(1).max(20).optional(),
  gstRatePct: z.number().min(0).max(100).optional(),
  hsnCode: z.string().max(12).optional(),
  isPerishable: z.boolean().optional(),
  shelfLifeDays: z.number().int().min(0).max(100000).optional(),
  attributes: z.array(ProductAttrSchema).max(50).optional(),
}).strict();
export type UpdateProductDto = z.infer<typeof UpdateProductSchema>;
