// modules/logistics/dto/update-shipment.dto.ts · zod .strict() action payloads (one per lifecycle step).
import { z } from 'zod';

export const AssignShipmentSchema = z.object({
  partnerId: z.string().uuid().optional(),
  vehicleId: z.string().uuid().optional(),
  riderUserId: z.string().uuid().optional(),
  awbNo: z.string().max(60).optional(),
}).strict().refine((v) => v.partnerId || v.vehicleId || v.riderUserId, { message: 'assign at least one of partnerId/vehicleId/riderUserId' });
export type AssignShipmentDto = z.infer<typeof AssignShipmentSchema>;

export const SchedulePickupSchema = z.object({
  scheduledPickupAt: z.string().datetime(),
  windowMins: z.coerce.number().int().min(0).max(1440).optional(),
  /** PC-56 TENANT-5a · there is nobody to hand over from (a collection from the tenant's own yard), so no
   *  pickup OTP is issued. Defaults to FALSE — the safe default is to issue the code, because the cost of an
   *  unnecessary OTP is one SMS and the cost of a missing one is an unprovable handover. */
  fromOwnPremises: z.coerce.boolean().optional(),
}).strict();
export type SchedulePickupDto = z.infer<typeof SchedulePickupSchema>;

// proof-of-delivery: the buyer's OTP (4–8 digits) + optional signed POD media id.
export const DeliverShipmentSchema = z.object({
  otp: z.string().regex(/^\d{4,8}$/, 'otp must be 4–8 digits'),
  podMediaId: z.string().uuid().optional(),
}).strict();
export type DeliverShipmentDto = z.infer<typeof DeliverShipmentSchema>;

export const FailShipmentSchema = z.object({ reason: z.string().min(1).max(500) }).strict();
export type FailShipmentDto = z.infer<typeof FailShipmentSchema>;

// rider location ping: append a lat/lng tracking point (no status change). Coordinates are validated
// to real WGS84 ranges; a short optional note (e.g. "at Karjan checkpoint").
export const ShipmentLocationSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  note: z.string().max(200).optional(),
}).strict();
export type ShipmentLocationDto = z.infer<typeof ShipmentLocationSchema>;

/** PC-56 TENANT-5a · the seller's pickup OTP, mirroring DeliverShipmentSchema's shape and bounds. Optional
 *  because a shipment with no issued pickup code (pre-wave, or an own-premises collection) is picked up
 *  without one — see `Shipment.markPickedUp`. */
export const PickupOtpSchema = z.object({
  otp: z.string().regex(/^\d{4,8}$/, 'otp must be 4–8 digits').optional(),
}).strict();
export type PickupOtpDto = z.infer<typeof PickupOtpSchema>;

/** PC-56 TENANT-5a · W236's event explorer query. `filter` is a fixed vocabulary (the four chips the canon
 *  draws) rather than a free query builder, and the window is resolved server-side — the canon's rule is
 *  "date-bounded queries only", so there is no "all time" to ask for. */
export const QueryShipmentEventsSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  filter: z.enum(['all', 'failed', 'at_hub', 'door_open', 'gps_gap']).optional(),
  shipmentId: z.string().uuid().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type QueryShipmentEventsDto = z.infer<typeof QueryShipmentEventsSchema>;
