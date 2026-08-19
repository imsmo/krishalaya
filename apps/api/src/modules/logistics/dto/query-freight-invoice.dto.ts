// modules/logistics/dto/query-freight-invoice.dto.ts · W241's list filters (PC-56 TENANT-5c). Keyset only.
import { z } from 'zod';

export const QueryFreightInvoiceSchema = z.object({
  /** 0070's own vocabulary, so a filter cannot ask for a status the CHECK forbids. */
  reconStatus: z.enum(['pending', 'exact_match', 'variance_open', 'disputed_lines', 'reconciled', 'booked_ops']).optional(),
  carrierId: z.string().uuid().optional(),
  sourceKind: z.enum(['carrier_invoice', 'own_fleet_cost_note']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryFreightInvoiceDto = z.infer<typeof QueryFreightInvoiceSchema>;
