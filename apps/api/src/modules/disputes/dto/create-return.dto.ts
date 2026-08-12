// modules/disputes/dto/create-return.dto.ts · zod .strict() (rejects unknown keys → no mass-assignment).
// The buyer sends the order + an optional reason CODE (resolved to a lookup_value id server-side) and an
// optional dispute link. The order's buyer/seller are resolved from eligibility — never client-supplied
// (anti-IDOR). Reuses the dispute_reason taxonomy (damaged/wrong_item/poor_quality/… ).
import { z } from 'zod';
import { DISPUTE_REASON_CODES } from './create-dispute.dto';

export const CreateReturnSchema = z.object({
  orderId: z.string().uuid(),
  reasonCode: z.enum(DISPUTE_REASON_CODES).optional(),
  disputeId: z.string().uuid().optional(),
  // W142's "Refund value" column (0139 gave it a home). Bounded by the order total server-side.
  refundAmountMinor: z.string().regex(/^[1-9]\d{0,15}$/, 'must be a positive integer string of minor units').optional(),
}).strict();
export type CreateReturnDto = z.infer<typeof CreateReturnSchema>;

/** W142's "Inspect" action — the note is what the buyer reads when their refund is decided, so it has a floor. */
export const InspectReturnSchema = z.object({
  note: z.string().min(20, 'an inspection note of at least 20 characters is required').max(4000),
}).strict();
export type InspectReturnDto = z.infer<typeof InspectReturnSchema>;
