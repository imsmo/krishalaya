// modules/logistics/dto/create-delivery-route.dto.ts · create/update a Village Run route (zod .strict).
import { z } from 'zod';

const Weekday = z.coerce.number().int().min(0).max(6);
const RegionIds = z.array(z.string().uuid()).max(2000);

export const CreateDeliveryRouteSchema = z.object({
  defaultName: z.string().trim().min(1).max(150),
  runWeekday: Weekday.nullable().optional(),
  villageRegionIds: RegionIds.default([]),
  vehicleId: z.string().uuid().nullable().optional(),
  consolidationUserId: z.string().uuid().nullable().optional(),
}).strict();
export type CreateDeliveryRouteDto = z.infer<typeof CreateDeliveryRouteSchema>;

export const UpdateDeliveryRouteSchema = z.object({
  defaultName: z.string().trim().min(1).max(150).optional(),
  runWeekday: Weekday.nullable().optional(),
  villageRegionIds: RegionIds.optional(),
  vehicleId: z.string().uuid().nullable().optional(),
  consolidationUserId: z.string().uuid().nullable().optional(),
}).strict().refine((d) => Object.keys(d).length > 0, { message: 'at least one field is required' });
export type UpdateDeliveryRouteDto = z.infer<typeof UpdateDeliveryRouteSchema>;

/**
 * PC-56 TENANT-5b · W231's [Approve route] may CARRY the commitments it is approving.
 *
 * The canon's proposal row shows `unassigned` in the vehicle column, and the restricted state says approval
 * "commits a vehicle + ambassador weekly" — so the two facts are chosen AT approval, not typed a week earlier.
 * Accepting them here keeps that in ONE transaction: a console that PATCHed the route and then POSTed the
 * approval could leave a route carrying a committed vehicle and no approval if the second call failed.
 */
export const ApproveDeliveryRouteSchema = z.object({
  vehicleId: z.string().uuid().optional(),
  consolidationUserId: z.string().uuid().optional(),
}).strict();
export type ApproveDeliveryRouteDto = z.infer<typeof ApproveDeliveryRouteSchema>;
