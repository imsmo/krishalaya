// modules/logistics/dto/query-delivery-zone.dto.ts · list zones (optionally by serviced pincode), MICROSECOND keyset (F-14).
import { z } from 'zod';
export const QueryDeliveryZoneSchema = z.object({
  pincode: z.string().regex(/^[1-9][0-9]{5}$/).optional(),   // zones serving this PIN
  activeOnly: z.enum(['true', 'false']).transform((v) => v === 'true').default('true'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryDeliveryZoneDto = z.infer<typeof QueryDeliveryZoneSchema>;
