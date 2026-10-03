// modules/payments/dto/query-commission-rule.dto.ts · list the tenant's commission rules / proposals, MICROSECOND keyset (F-14).
import { z } from 'zod';
export const QueryCommissionRuleSchema = z.object({
  activeOnly: z.enum(['true', 'false']).transform((v) => v === 'true').default('true'),
  includePlatformDefaults: z.enum(['true', 'false']).transform((v) => v === 'true').default('false'),   // inherited platform defaults (read-only)
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryCommissionRuleDto = z.infer<typeof QueryCommissionRuleSchema>;

export const QueryCommissionProposalSchema = z.object({
  status: z.enum(['proposed', 'confirmed', 'refused', 'expired', 'applied']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryCommissionProposalDto = z.infer<typeof QueryCommissionProposalSchema>;
