// modules/logistics/dto/query-delivery-route.dto.ts · list Village Run routes (optionally by run weekday), keyset.
import { z } from 'zod';
export const QueryDeliveryRouteSchema = z.object({
  runWeekday: z.coerce.number().int().min(0).max(6).optional(),
  activeOnly: z.coerce.boolean().default(true),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryDeliveryRouteDto = z.infer<typeof QueryDeliveryRouteSchema>;

/** W231's board (PC-56 TENANT-5b). Filters on the STATE MACHINE rather than on a boolean, because the screen's
 *  whole subject is the difference between a proposal and a run. No `activeOnly`: a board that hides proposals
 *  hides the [Approve route] row it exists for. */
export const QueryRouteBoardSchema = z.object({
  status: z.enum(['proposed', 'active', 'inactive']).optional(),
  runWeekday: z.coerce.number().int().min(0).max(6).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryRouteBoardDto = z.infer<typeof QueryRouteBoardSchema>;
