// modules/livestock/dto/query-vet-booking.dto.ts · zod .strict() vet-booking list query (keyset pagination).
import { z } from 'zod';
import { VET_BOOKING_STATUSES } from '../domain/vet-booking.state';
export const QueryVetBookingsSchema = z.object({
  box: z.enum(['farmer', 'vet']).prefault('farmer'),   // farmer=mine as payer; vet=mine as provider
  status: z.enum(VET_BOOKING_STATUSES as unknown as [string, ...string[]]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryVetBookingsDto = z.infer<typeof QueryVetBookingsSchema>;
