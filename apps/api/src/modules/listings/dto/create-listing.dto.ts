// modules/listings/dto/create-listing.dto.ts · validated create payload.
// priceMinor is a STRING over the wire (bigint-safe JSON); parsed in service.
import { z } from 'zod';

const AttrValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), attributeId: z.string().uuid(), text: z.string().max(2000) }),
  z.object({ kind: z.literal('number'), attributeId: z.string().uuid(), number: z.number() }),
  z.object({ kind: z.literal('bool'), attributeId: z.string().uuid(), bool: z.boolean() }),
  z.object({ kind: z.literal('date'), attributeId: z.string().uuid(), date: z.string().date() }),
  z.object({ kind: z.literal('option'), attributeId: z.string().uuid(), optionId: z.string().uuid() }),
]);

export const CreateListingSchema = z.object({
  productId: z.string().uuid(),
  categoryId: z.string().uuid(),
  title: z.string().trim().min(3).max(250),
  description: z.string().max(5000).optional(),
  quantityTotal: z.number().positive().max(1_000_000),
  minOrderQty: z.number().min(0).default(0),
  unitCode: z.string().min(1).max(20),
  priceMinor: z.string().regex(/^[1-9]\d{0,15}$/, 'positive integer minor units'),
  currencyCode: z.string().length(3).default('INR'),
  saleType: z.enum(['direct', 'auction', 'both', 'preorder', 'service', 'group_lot']).default('direct'),
  organicClaim: z.enum(['none', 'natural', 'certified']).default('none'),
  pincode: z.string().regex(/^\d{4,10}$/).optional(),
  regionId: z.string().uuid().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  visibility: z.enum(['tenant', 'cross_tenant', 'public']).default('tenant'),
  publishAt: z.string().datetime().optional(),
  harvestDate: z.string().date().optional(),   // TENANT-2b: 0005's column, first carried — W124/W125 show it
  attributes: z.array(AttrValueSchema).max(50).optional(),
  mediaIds: z.array(z.string().uuid()).max(10).optional(),
}).strict();
export type CreateListingDto = z.infer<typeof CreateListingSchema>;
