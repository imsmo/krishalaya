// modules/disputes/dto/refund-approval.dto.ts · zod .strict() payloads for the refund maker-checker plane (0139).
// The SUBJECT is never trusted from the client beyond its type+id: the service re-reads the dispute/return in the
// deciding transaction, so an id belonging to another tenant simply is not found (Law 1 + RLS).
import { z } from 'zod';
import { REFUND_SUBJECTS, MIN_NOTE_CHARS } from '../domain/refund-gate';

export const ProposeRefundSchema = z.object({
  subjectType: z.enum(REFUND_SUBJECTS as unknown as [string, ...string[]]),
  subjectId: z.string().uuid(),
  amountMinor: z.string().regex(/^[1-9]\d{0,15}$/, 'must be a positive integer string of minor units'),
  resolutionType: z.enum(['refund_full', 'refund_partial']).optional(),
  // The checker reads this before signing for somebody else's money. A one-word proposal is not a proposal.
  note: z.string().min(MIN_NOTE_CHARS, `at least ${MIN_NOTE_CHARS} characters`).max(2000),
}).strict();
export type ProposeRefundDto = z.infer<typeof ProposeRefundSchema>;

export const DecideRefundSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  // Required on a refusal (0139's CHECK), optional on an approval — the proposer already stated the case, and
  // forcing a sentence to agree produces "ok" (the shape TENANT-2b removed from the moderator archive path).
  note: z.string().max(2000).optional(),
}).strict();
export type DecideRefundDto = z.infer<typeof DecideRefundSchema>;

export const QueryRefundApprovalsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type QueryRefundApprovalsDto = z.infer<typeof QueryRefundApprovalsSchema>;
