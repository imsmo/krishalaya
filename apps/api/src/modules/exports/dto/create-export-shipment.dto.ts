// modules/exports/dto/create-export-shipment.dto.ts · zod .strict() shipment create + lifecycle payloads.
// totalValueMinor is bigint minor units (informational LC value; no in-platform money move).
import { z } from 'zod';
import { SHIPMENT_STATUSES } from '../domain/export-shipment.state';
const minorStr = z.string().regex(/^\d{1,15}$/);
export const CreateShipmentSchema = z.object({
  destinationCountry: z.string().regex(/^[A-Z]{2}$/, 'ISO-3166 alpha-2'),
  incoterm: z.string().max(10).optional(),
  orderIds: z.array(z.string().uuid()).max(500).prefault([]),
  totalValueMinor: minorStr.optional(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).prefault('USD'),
}).strict();
export type CreateShipmentDto = z.infer<typeof CreateShipmentSchema>;

export const AdvanceShipmentSchema = z.object({
  to: z.enum(SHIPMENT_STATUSES as unknown as [string, ...string[]]),
  vesselOrAwb: z.string().max(80).optional(),
  lcRef: z.string().max(80).optional(),
}).strict();
export type AdvanceShipmentDto = z.infer<typeof AdvanceShipmentSchema>;
