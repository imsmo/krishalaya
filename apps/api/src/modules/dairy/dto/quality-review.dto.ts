// modules/dairy/dto/quality-review.dto.ts · zod .strict() payloads for W168's flag protocol (PC-56 TENANT-6b-1).
import { z } from 'zod';
import { REVIEW_STATUSES } from '../domain/milk-quality.state';

/**
 * W168 step 1: *"Operator re-tests sealed sample with member present (today evening shift)"*.
 *
 * `memberPresent` is REQUIRED, not defaulted. A default of true would let the platform record a member's presence
 * nobody checked, which is the dignity half of the promise; a default of false would libel operators who did the right
 * thing. So the caller answers, and the desk shows the answer.
 */
export const RetestReviewSchema = z.object({
  memberPresent: z.boolean(),
  /** *"Sample retained & sealed"* — a claim about a PHYSICAL act this platform cannot witness, recorded with the name
   *  of whoever asserts it and never as something the system established. */
  sampleSealed: z.boolean().optional(),
  note: z.string().max(2000).nullish(),
}).strict();
export type RetestReviewDto = z.infer<typeof RetestReviewSchema>;

/**
 * W168 step 2: *"Confirmed dilution → pour rejected, gentle first-time conversation"*.
 *
 * Only the two terminal outcomes are accepted. `retested` is not an outcome a caller may set — it is what the re-test
 * endpoint records — and `open` is not something a decision can go back to: a decision reversed is a new dispute with
 * its own record, not an edit that erases the first one.
 */
export const DecideReviewSchema = z.object({
  outcome: z.enum(['cleared', 'rejected']),
  note: z.string().max(2000).nullish(),
}).strict();
export type DecideReviewDto = z.infer<typeof DecideReviewSchema>;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The desk's list (TENANT-6b-2 draws it). `open_any` is the working queue — open plus re-tested-not-yet-decided —
 *  because those are the pours whose money is being held right now. */
export const QueryReviewsSchema = z.object({
  status: z.enum([...REVIEW_STATUSES, 'open_any'] as unknown as [string, ...string[]]).optional(),
  membershipId: z.string().uuid().optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryReviewsDto = z.infer<typeof QueryReviewsSchema>;
