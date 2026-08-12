// modules/listings/dto/listing-detail.dto.ts · W124/W125 (PC-56 TENANT-2b)
import { z } from 'zod';
import { CreateListingSchema } from './create-listing.dto';

/** W124's danger zone: a reason the SELLER will read. Mandatory for a staff hand (enforced in the service,
 *  where the actor≠seller fact lives); optional for a seller removing their own listing. */
export const ArchiveListingSchema = z.object({
  reason: z.string().max(500).optional(),
}).strict();
export type ArchiveListingDto = z.infer<typeof ArchiveListingSchema>;

/** W125 on-behalf: the member whose produce it is + the ordinary create payload. */
export const OnBehalfCreateSchema = CreateListingSchema.extend({
  sellerUserId: z.string().uuid(),
}).strict();
export type OnBehalfCreateDto = z.infer<typeof OnBehalfCreateSchema>;

export const FairPriceSchema = z.object({
  productId: z.string().uuid(),
  pincode: z.string().regex(/^\d{4,10}$/),
}).strict();
export type FairPriceDto = z.infer<typeof FairPriceSchema>;
