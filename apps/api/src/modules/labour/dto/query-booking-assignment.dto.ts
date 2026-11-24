// modules/labour/dto/query-booking-assignment.dto.ts · zod .strict() assignment list query (keyset).
import { z } from 'zod';
import { ASSIGNMENT_STATUSES } from '../domain/booking-assignment.state';
export const QueryAssignmentsSchema = z.object({
  box: z.enum(['mine', 'booking']).prefault('mine'),  // mine=worker's own; booking=by bookingId (employer)
  bookingId: z.string().uuid().optional(),
  status: z.enum(ASSIGNMENT_STATUSES as unknown as [string, ...string[]]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryAssignmentsDto = z.infer<typeof QueryAssignmentsSchema>;
