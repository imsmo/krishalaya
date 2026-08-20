// modules/dairy/dto/milk-bill-dispute.dto.ts · PC-56 TENANT-6c-2 · zod .strict() payloads for the member's objection
// and the cooperative's answer. The 10-character floor is asserted here AND in the domain AND in the database: the DTO
// gives the caller a 422 they can act on, the domain is what a service calling itself cannot bypass, and the CHECK is
// what a hand-written UPDATE cannot.
import { z } from 'zod';

export const RaiseDisputeSchema = z.object({
  /** The member's own words. Not a code list — see 0158's column comment for why. */
  reason: z.string().trim().min(10).max(2000),
}).strict();
export type RaiseDisputeDto = z.infer<typeof RaiseDisputeSchema>;

export const ResolveDisputeSchema = z.object({
  outcome: z.enum(['upheld', 'rejected']),
  /** What the member is told. Required, because "resolved" has to mean something they can read. */
  note: z.string().trim().min(10).max(2000),
  /**
   * Void and rebuild the bill. Only meaningful with `upheld` (the domain and the database both refuse the other
   * combination): this platform cannot amend a milk bill's arithmetic in place, so releasing the pours and letting the
   * cycle rebuild is the correction.
   */
  voidBill: z.boolean().default(false),
}).strict();
export type ResolveDisputeDto = z.infer<typeof ResolveDisputeSchema>;

export const VoidBillSchema = z.object({
  reason: z.string().trim().min(10).max(2000),
}).strict();
export type VoidBillDto = z.infer<typeof VoidBillSchema>;
