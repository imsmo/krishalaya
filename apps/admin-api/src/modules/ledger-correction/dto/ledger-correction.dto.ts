// apps/admin-api/src/modules/ledger-correction/dto/ledger-correction.dto.ts · zod .strict() (PC-56 ADMIN-5e).
//
// **AMOUNTS ARE STRINGS AT THE BOUNDARY AND THAT IS NOT A STYLE CHOICE.** `z.number()` on a money field would accept
// a value JSON already rounded — `JSON.parse('{"a":9007199254740993}')` gives 9007199254740992 — and the loss
// happens before any validator sees it. A string of minor units crosses intact and becomes a bigint in the domain.
// Law 2, enforced at the only place it can be.
import { z } from 'zod';

const MinorString = z.string().regex(/^-?[0-9]{1,18}$/, 'minor units, as a string of digits');

export const LegSchema = z.object({
  ownerKind: z.enum(['user', 'tenant', 'platform']),
  ownerId: z.string().uuid().nullish(),
  accountCode: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  amountMinor: MinorString,
  legNote: z.string().max(300).nullish(),
}).strict();

export const OpenDraftSchema = z.object({
  investigationId: z.string().uuid(),
  tenantId: z.string().uuid().nullish(),
  /** Recorded VERBATIM. The length floor is in the domain so the refusal explains what the sentence is for. */
  reason: z.string().min(1).max(4000),
  sourceDocument: z.string().max(300).nullish(),
  currencyCode: z.string().length(3).nullish(),
}).strict();
export type OpenDraftDto = z.infer<typeof OpenDraftSchema>;

export const SaveLegsSchema = z.object({
  /** The WHOLE leg set, every time. A partial update is how a draft ends up balanced in the operator's head and
   *  unbalanced in the table. Capped at 20: a correction with more legs than that is a batch, and a batch typed by
   *  hand at 02:14 is not a correction. */
  legs: z.array(LegSchema).min(1).max(20),
}).strict();
export type SaveLegsDto = z.infer<typeof SaveLegsSchema>;

export const DecideSchema = z.object({
  note: z.string().min(1).max(2000),
  /** W068: "Corrections above ₹50,000 additionally page the founder." The platform cannot page anybody, so this is
   *  the checker CONFIRMING they did it out of band. Recorded in the audit ledger as a claim by a named person,
   *  which is what it is — see the domain's note on why a `notified_founder_at` timestamp would be worse. */
  founderInformed: z.boolean().optional(),
}).strict();
export type DecideDto = z.infer<typeof DecideSchema>;

export const WithdrawSchema = z.object({ note: z.string().min(1).max(2000) }).strict();
export type WithdrawDto = z.infer<typeof WithdrawSchema>;

export const QueryDraftsSchema = z.object({
  status: z.enum(['drafting', 'awaiting_checker', 'posted', 'rejected', 'withdrawn']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type QueryDraftsDto = z.infer<typeof QueryDraftsSchema>;
