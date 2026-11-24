// modules/fintech/dto/query-financial-partner.dto.ts · zod .strict() partner browse (read-only).
import { z } from 'zod';
import { PARTNER_KINDS } from '../domain/fintech.events';
export const QueryPartnersSchema = z.object({
  partnerKind: z.enum(PARTNER_KINDS as unknown as [string, ...string[]]).optional(),
  activeOnly: z.coerce.boolean().prefault(true),
}).strict();
export type QueryPartnersDto = z.infer<typeof QueryPartnersSchema>;
