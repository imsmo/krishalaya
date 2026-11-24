// modules/warehousing/dto/query-storage-booking.dto.ts · zod .strict() booking list query (keyset).
import { z } from 'zod';
import { BOOKING_STATUSES } from '../domain/storage-booking.state';
export const QueryBookingsSchema = z.object({
  box: z.enum(['depositor', 'warehouse', 'all']).prefault('depositor'),
  warehouseId: z.string().uuid().optional(),
  status: z.enum(BOOKING_STATUSES as unknown as [string, ...string[]]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryBookingsDto = z.infer<typeof QueryBookingsSchema>;
