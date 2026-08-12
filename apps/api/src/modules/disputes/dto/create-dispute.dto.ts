// modules/disputes/dto/create-dispute.dto.ts · zod .strict() (rejects unknown keys → no mass-assignment).
// The client sends only the order + a reason CODE (resolved to a lookup_value id server-side) + free
// text; the counterparty (against_user) is resolved from eligibility — never client-supplied (anti-IDOR).
import { z } from 'zod';

export const DISPUTE_REASON_CODES = ['not_delivered', 'poor_quality', 'qty_mismatch', 'late', 'wrong_item', 'damaged', 'payment', 'bid_manipulation', 'fake_certificate'] as const;

export const CreateDisputeSchema = z.object({
  orderId: z.string().uuid(),
  reasonCode: z.enum(DISPUTE_REASON_CODES),
  description: z.string().max(4000).optional(),
  // W141's "disputed value ₹12,820 (2 of 10 qtl)". Optional, because a buyer disputing "nothing arrived" has no
  // partial figure to give — and because 0139 lets the column be NULL and means it. Bounded by the order total
  // server-side; a positive integer string of minor units, never a float (Law 2).
  disputedAmountMinor: z.string().regex(/^[1-9]\d{0,15}$/, 'must be a positive integer string of minor units').optional(),
  disputedQuantity: z.string().regex(/^\d{1,10}(\.\d{1,3})?$/, 'must be a decimal quantity').optional(),
}).strict();
export type CreateDisputeDto = z.infer<typeof CreateDisputeSchema>;
