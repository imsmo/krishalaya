import { z } from 'zod';
import { POSTAL_CODE_RE } from '../../../shared/utils/postal-code';
// PC-56 STORE-4a · B3 (founder D4 · Rule Zero):
//   • `countryCode` is REQUIRED on create (two letters, upper-cased) — the API's 'IN' default is gone, as is the DB's (migration 0214): an
//     address names its country or is refused (422 VALIDATION_FAILED). An edit may change it (HOTFIX-6) and need not repeat it.
//   • `labelId` — an `address_label` value visible to the caller's organisation (validated IN the write's transaction — ADDRESS_LABEL_UNKNOWN,
//     the 3a `cancel_reason` shape); null clears it on an edit.
//   • `deliveryNote` — the note whoever delivers reads (gate, landmark, vehicle size), at most 280 characters (0214); null or '' clears it.
/** PC-56 STORE-4a: the delivery note's bound (0214 `addresses.delivery_note varchar(280)`). */
export const DELIVERY_NOTE_MAX = 280;
const COUNTRY = z.string().trim().regex(/^[A-Za-z]{2}$/, 'a two-letter country code').transform((s) => s.toUpperCase());
const NOTE = z.string().trim().max(DELIVERY_NOTE_MAX).transform((s) => (s === '' ? null : s)).nullable();
export const CreateAddressSchema = z.object({
  labelId: z.string().uuid().nullable().optional(),
  line1: z.string().trim().min(3).max(250),
  line2: z.string().max(250).optional(),
  village: z.string().max(150).optional(),
  regionId: z.string().uuid().optional(),
  pincode: z.string().regex(POSTAL_CODE_RE).optional(),   // PC-56 STORE-2c: the one rule (shared/utils/postal-code.ts) — byte-identical to the old literal
  countryCode: COUNTRY,
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  contactName: z.string().max(150).optional(),
  contactPhone: z.string().max(20).optional(),
  deliveryNote: NOTE.optional(),
  isDefault: z.boolean().default(false),
}).strict();
export type CreateAddressDto = z.infer<typeof CreateAddressSchema>;
export const UpdateAddressSchema = CreateAddressSchema.partial().strict();
export type UpdateAddressDto = z.infer<typeof UpdateAddressSchema>;
