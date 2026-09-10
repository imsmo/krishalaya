// modules/ai-governance/dto/submit-appeal.dto.ts · zod .strict() — a person appeals a decision that hit THEM.
//
// [PC-56 TENANT-6e-2 2026-09-10 · RESTORED] This file was ABSENT from the repository at this wave's baseline while two
// committed files import it (`controllers/v1/appeals.controller.ts`, `services/appeal.service.ts`), so `apps/api` did not
// type-check at HEAD — the wave that wrote the appeal path never committed its DTO. Reconstructed from the two consumers
// and `__tests__/appeal-submit.service.spec.ts` (which shows the exact shapes: `{ subjectAction, subjectId?, note? }` and
// a keyset `{ cursor?, limit }` list), with the domain's own closed list of actions. Not a schema this wave invented: the
// validated field names are the ones the service reads (`dto.subjectAction`, `dto.subjectId`, `dto.note`).
import { z } from 'zod';
import { APPEALABLE_ACTIONS } from '../domain/appeal-submit';

export const SubmitAppealSchema = z.object({
  subjectAction: z.enum(APPEALABLE_ACTIONS),
  /** The listing or review id; ignored for `account_restricted` (the subject is the caller — `subjectIdFor`). */
  subjectId: z.string().uuid().optional(),
  /** The appellant's own words; kept in the audit row's `reason` (0067's filed shape has no note column). */
  note: z.string().trim().max(1000).optional(),
}).strict();
export type SubmitAppealDto = z.infer<typeof SubmitAppealSchema>;

export const QueryMyAppealsSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryMyAppealsDto = z.infer<typeof QueryMyAppealsSchema>;
