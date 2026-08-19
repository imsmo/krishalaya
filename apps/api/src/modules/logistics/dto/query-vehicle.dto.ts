// modules/logistics/dto/query-vehicle.dto.ts · list vehicles (optionally by partner), keyset pagination.
import { z } from 'zod';
export const QueryVehicleSchema = z.object({
  partnerId: z.string().uuid().optional(),
  activeOnly: z.coerce.boolean().default(true),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryVehicleDto = z.infer<typeof QueryVehicleSchema>;

/** W229's register (PC-56 TENANT-5b). `activeOnly` DEFAULTS TO FALSE here, unlike the raw vehicle list: the whole
 *  point of a safety register is that a PARKED vehicle is the row you have to look at. */
export const QueryFleetRegisterSchema = z.object({
  partnerId: z.string().uuid().optional(),
  activeOnly: z.coerce.boolean().default(false),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryFleetRegisterDto = z.infer<typeof QueryFleetRegisterSchema>;
