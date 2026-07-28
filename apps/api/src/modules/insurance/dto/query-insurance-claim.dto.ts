// modules/insurance/dto/query-insurance-claim.dto.ts · zod .strict() "my claims" / insurer-queue list query
// (keyset; screen 291's status tracker maps onto the `status` filter).
import { z } from 'zod';
import { CLAIM_STATUSES } from '../domain/insurance-claim.state';

export const QueryInsuranceClaimsSchema = z.object({
  status: z.enum(CLAIM_STATUSES as unknown as [string, ...string[]]).optional(),
  policyId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryInsuranceClaimsDto = z.infer<typeof QueryInsuranceClaimsSchema>;
