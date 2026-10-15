import { z } from 'zod';
import { POSTAL_CODE_RE } from '../../../shared/utils/postal-code';
export const CreateAddressSchema = z.object({
  labelId: z.string().uuid().optional(),
  line1: z.string().trim().min(3).max(250),
  line2: z.string().max(250).optional(),
  village: z.string().max(150).optional(),
  regionId: z.string().uuid().optional(),
  pincode: z.string().regex(POSTAL_CODE_RE).optional(),   // PC-56 STORE-2c: the one rule (shared/utils/postal-code.ts) — byte-identical to the old literal
  countryCode: z.string().length(2).default('IN'),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  contactName: z.string().max(150).optional(),
  contactPhone: z.string().max(20).optional(),
  isDefault: z.boolean().default(false),
}).strict();
export type CreateAddressDto = z.infer<typeof CreateAddressSchema>;
export const UpdateAddressSchema = CreateAddressSchema.partial().strict();
export type UpdateAddressDto = z.infer<typeof UpdateAddressSchema>;
