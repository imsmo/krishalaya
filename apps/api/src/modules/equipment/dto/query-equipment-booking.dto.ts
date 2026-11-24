// modules/equipment/dto/query-equipment-booking.dto.ts · zod .strict() booking list query (keyset).
import { z } from 'zod';
import { RENTAL_STATUSES } from '../domain/equipment-booking.state';
export const QueryBookingsSchema = z.object({
  box: z.enum(['renter', 'owner', 'all']).prefault('renter'),
  status: z.enum(RENTAL_STATUSES as unknown as [string, ...string[]]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryBookingsDto = z.infer<typeof QueryBookingsSchema>;
