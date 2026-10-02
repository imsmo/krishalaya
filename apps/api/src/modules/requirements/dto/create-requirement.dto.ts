// modules/requirements/dto/create-requirement.dto.ts · zod .strict() (rejects unknown keys → no mass-assignment).
import { z } from 'zod';
import { OnBehalfSchema } from './requirement-desk.dto';

const minor0 = z.string().regex(/^\d{1,16}$/, 'must be a non-negative integer string of minor units');
const qty = z.string().regex(/^\d{1,11}(\.\d{1,3})?$/, 'must be a positive number with up to 3 decimals');

export const CreateRequirementSchema = z.object({
  title: z.string().min(3).max(250),
  quantity: qty,
  unitCode: z.string().min(1).max(20),
  productId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  budgetMinMinor: minor0.optional(),
  budgetMaxMinor: minor0.optional(),
  currencyCode: z.string().length(3).optional(),
  needBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'needBy must be YYYY-MM-DD').optional(),
  deliveryPincode: z.string().regex(/^\d{6}$/, 'pincode must be 6 digits').optional(),
  isUrgent: z.boolean().optional(),
  // PC-56 TENANT-11d · A3 — the buyer desk posts FOR a named buyer, with that buyer's recorded consent (requirement.desk).
  onBehalf: OnBehalfSchema.optional(),
}).strict();
export type CreateRequirementDto = z.infer<typeof CreateRequirementSchema>;
