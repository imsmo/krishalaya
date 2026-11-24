// modules/fintech/dto/query-loan-product.dto.ts · zod .strict() loan-product browse (read-only).
import { z } from 'zod';
export const QueryLoanProductsSchema = z.object({
  partnerId: z.string().uuid().optional(),
  activeOnly: z.coerce.boolean().prefault(true),
}).strict();
export type QueryLoanProductsDto = z.infer<typeof QueryLoanProductsSchema>;
