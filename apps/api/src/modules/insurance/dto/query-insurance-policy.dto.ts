// modules/insurance/dto/query-insurance-policy.dto.ts · zod .strict() "my policies" list query (keyset;
// screen 287's All/Active/Lapsed/Claimed tabs map straight onto the `status` filter).
import { z } from 'zod';
import { POLICY_STATUSES } from '../domain/insurance-policy.state';
export const QueryInsurancePoliciesSchema = z.object({
  status: z.enum(POLICY_STATUSES as unknown as [string, ...string[]]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryInsurancePoliciesDto = z.infer<typeof QueryInsurancePoliciesSchema>;
