// modules/logistics/dto/query-shipment.dto.ts · list/filter query params (cursor pagination, never OFFSET).
import { z } from 'zod';
import { SHIPMENT_STATUSES } from '../domain/shipment.state';

// box=all → tenant ops view (needs logistics.manage); box=mine → the calling rider's assigned shipments.
export const SHIPMENT_BOXES = ['all', 'mine'] as const;
export type ShipmentBox = (typeof SHIPMENT_BOXES)[number];

export const QueryShipmentsSchema = z.object({
  box: z.enum(SHIPMENT_BOXES).prefault('all'),
  status: z.enum(SHIPMENT_STATUSES).optional(),
  orderId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(20),
}).strict();
export type QueryShipmentsDto = z.infer<typeof QueryShipmentsSchema>;
