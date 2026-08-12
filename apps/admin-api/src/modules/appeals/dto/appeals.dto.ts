// apps/admin-api/src/modules/appeals/dto/appeals.dto.ts · zod .strict() (PC-56 ADMIN-SWEEP-b1).
//
// NOTE WHAT IS ABSENT, twice over: DECIDE carries no appellant, no subject and no original reviewer — all three are
// read from the row, because a client that could restate them could re-aim an overturn. And TAKE NEXT carries
// nothing at all: which appeal you get is the queue's decision (oldest deadline you are allowed to judge), not a
// request parameter — a claim that could name its appeal would let a reviewer cherry-pick.
import { z } from 'zod';

export const QueryAppealsSchema = z.object({
  status: z.enum(['pending', 'upheld', 'overturned']).default('pending'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type QueryAppealsDto = z.infer<typeof QueryAppealsSchema>;

export const DecideAppealSchema = z.object({
  outcome: z.enum(['upheld', 'overturned']),
  /** Shown to the appellant whatever the outcome (W097). The 20-char floor lives in the domain so the refusal
   *  explains what the sentence is FOR; zod only rules out the absurd. */
  reason: z.string().min(1).max(2000),
  /** The language the reason is WRITTEN in — the operator writes in the appellant's language (shown on the case
   *  page), and this label must be true: 0112's rule, "a note composed in English and delivered under a Gujarati
   *  template is a message the farmer cannot read wearing a label saying they can". */
  languageCode: z.string().min(2).max(8),
}).strict();
export type DecideAppealDto = z.infer<typeof DecideAppealSchema>;

export const TakeNextSchema = z.object({}).strict();
export type TakeNextDto = z.infer<typeof TakeNextSchema>;
