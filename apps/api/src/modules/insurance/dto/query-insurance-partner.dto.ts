// modules/insurance/dto/query-insurance-partner.dto.ts · zod .strict() IRDAI-partner browse (read-only).
// Mirrors modules/fintech/dto/query-financial-partner.dto.ts; this module always filters partnerKind='insurer'
// server-side (the gate — see insurance-product.service.ts), so the DTO does not accept a partnerKind override.
import { z } from 'zod';
export const QueryInsurancePartnersSchema = z.object({
  activeOnly: z.coerce.boolean().default(true),
}).strict();
export type QueryInsurancePartnersDto = z.infer<typeof QueryInsurancePartnersSchema>;
