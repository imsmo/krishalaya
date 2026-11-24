// modules/services-marketplace/dto/create-service-booking.dto.ts · zod .strict() booking request payload.
// total is server-computed from the offering price × guests (never client-supplied).
import { z } from 'zod';
export const RequestBookingSchema = z.object({
  offeringId: z.string().uuid(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  guests: z.number().int().min(1).max(10000).prefault(1),
  notes: z.string().max(2000).optional(),
}).strict();
export type RequestBookingDto = z.infer<typeof RequestBookingSchema>;
