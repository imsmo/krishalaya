// modules/dairy/dto/deduction-instruction.dto.ts · PC-56 TENANT-6c-5 · zod .strict() for the standing instruction.
import { z } from 'zod';

export const AuthoriseDeductionInstructionSchema = z.object({
  membershipId: z.string().uuid(),
  /** A `milk_deduction` vocabulary code (0160). Validated against the table, not against a list in this file. */
  type: z.string().min(1).max(40),
  /** Omitted = every source of this type. Set = one receivable, which is how an instalment on one debt is expressed. */
  sourceId: z.string().uuid().optional(),
  /**
   * The member's instalment: at most this much per cycle. Omitted means "the whole outstanding when the bill can
   * carry it". The tenant's assembly cap applies on top, so this can only ever make a deduction SMALLER — which is
   * why a member may set it and an operator may not raise it.
   */
  maxPerCycleMinor: z.string().regex(/^\d{1,15}$/).optional(),
  /** 0003's consent-channel vocabulary, reused: a farmer with no smartphone arranges this by IVR or beside an ambassador. */
  channel: z.enum(['app', 'web', 'ambassador_assisted', 'ivr']),
  /** Required by the database exactly when the channel is `ambassador_assisted`. */
  assistedBy: z.string().uuid().optional(),
  note: z.string().max(500).optional(),
}).strict();
export type AuthoriseDeductionInstructionDto = z.infer<typeof AuthoriseDeductionInstructionSchema>;
