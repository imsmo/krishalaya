// modules/orders/dto/create-checkout-group.dto.ts · the internal shape used to OPEN a checkout group
// (one payment spanning many sub-orders for a multi-seller cart). Not a public endpoint body — checkout
// builds this server-side from the resolved cart; kept as a typed, validated contract (bigint minor units
// as a string) so the checkout-group writer is type-safe. zod .strict().
import { z } from 'zod';

export const CreateCheckoutGroupSchema = z.object({
  buyerUserId: z.string().uuid(),
  totalMinor: z.string().regex(/^\d{1,18}$/, 'totalMinor must be a non-negative integer string of minor units'),
  currencyCode: z.string().length(3).prefault('INR'),
}).strict();
export type CreateCheckoutGroupDto = z.infer<typeof CreateCheckoutGroupSchema>;
