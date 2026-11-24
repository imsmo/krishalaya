// modules/payments/dto/query-settlement-statement.dto.ts · list a seller's settlement statements, keyset pagination.
import { z } from 'zod';
export const QuerySettlementStatementSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(20),
}).strict();
export type QuerySettlementStatementDto = z.infer<typeof QuerySettlementStatementSchema>;
