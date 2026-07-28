// modules/insurance/dto/query-insurance-product.dto.ts · zod .strict() product-catalogue browse (read-only).
// Keyset pagination (Law 11 — never OFFSET): afterId is the last-seen id (UUIDv7, time-ordered), mirrors
// modules/listings/repositories/listing.repository.ts's listBySeller cursor convention.
import { z } from 'zod';
export const QueryInsuranceProductsSchema = z.object({
  partnerId: z.string().uuid().optional(),
  productKindId: z.string().uuid().optional(),
  activeOnly: z.coerce.boolean().default(true),
  afterId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryInsuranceProductsDto = z.infer<typeof QueryInsuranceProductsSchema>;
