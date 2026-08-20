// modules/dairy/dto/member-credit.dto.ts · PC-56 TENANT-6c-4 · zod .strict() for the MCC's credit desk.
import { z } from 'zod';
const minorStr = z.string().regex(/^\d{1,15}$/);

export const IssueMemberCreditSchema = z.object({
  membershipId: z.string().uuid(),
  mccId: z.string().uuid().optional(),
  /**
   * What was sold, in the operator's own words. A floor rather than a code list — TENANT-6c-2's ruling on a dispute's
   * reason applies here too: a closed set of things a cooperative might sell on credit would be missing the case that
   * matters, and this is a description of a real transaction rather than a string a tenant admin configures.
   */
  description: z.string().min(3).max(200),
  valueMinor: minorStr,
  /** The MCC's own day. Omitted means "today", read from the DATABASE rather than from the pod's clock. */
  issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();
export type IssueMemberCreditDto = z.infer<typeof IssueMemberCreditSchema>;
