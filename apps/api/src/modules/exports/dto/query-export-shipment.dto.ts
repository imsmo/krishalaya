// modules/exports/dto/query-export-shipment.dto.ts · zod .strict() shipment list query (keyset).
import { z } from 'zod';
import { SHIPMENT_STATUSES } from '../domain/export-shipment.state';
export const QueryShipmentsSchema = z.object({
  box: z.enum(['mine', 'all']).prefault('mine'),
  status: z.enum(SHIPMENT_STATUSES as unknown as [string, ...string[]]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryShipmentsDto = z.infer<typeof QueryShipmentsSchema>;
