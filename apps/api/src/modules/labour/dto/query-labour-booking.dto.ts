// modules/labour/dto/query-labour-booking.dto.ts · zod .strict() booking list query (keyset pagination).
// PC-56 TENANT-11b: `sort=starts` (W163 "Starts ▴"), `counts=1` returns the per-status tab counts with the page.
import { z } from 'zod';
import { BOOKING_STATUSES } from '../domain/labour-booking.state';
export const QueryBookingsSchema = z.object({
  box: z.enum(['mine', 'open', 'all']).default('mine'),  // mine=employer's own; open=marketplace; all=desk/manage
  status: z.enum(BOOKING_STATUSES as unknown as [string, ...string[]]).optional(),
  taskSkillId: z.string().uuid().optional(),
  sort: z.enum(['recent', 'starts']).default('recent'),
  counts: z.enum(['0', '1']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryBookingsDto = z.infer<typeof QueryBookingsSchema>;
