// modules/livestock/dto/create-vet-booking.dto.ts · zod .strict() farmer "book a vet" + worker-side DTOs.
// fee is NOT client-supplied — the service snapshots vet_services.price_minor. animalId (optional) is
// ownership-checked server-side (anti-IDOR).
import { z } from 'zod';
import { VET_BOOKING_MODES, VET_BOOKING_URGENCIES } from '../domain/livestock.events';
export const BookVetSchema = z.object({
  vetId: z.string().uuid(),
  serviceId: z.string().uuid(),
  animalId: z.string().uuid().optional(),
  urgency: z.enum(VET_BOOKING_URGENCIES as unknown as [string, ...string[]]).prefault('routine'),
  mode: z.enum(VET_BOOKING_MODES as unknown as [string, ...string[]]).prefault('visit'),
  symptomsText: z.string().max(2000).optional(),
  scheduledAt: z.string().datetime().optional(),
}).strict();
export type BookVetDto = z.infer<typeof BookVetSchema>;

export const VetProgressSchema = z.object({
  action: z.enum(['accept', 'en_route', 'in_consult', 'prescribed', 'no_show']),
}).strict();
export type VetProgressDto = z.infer<typeof VetProgressSchema>;
