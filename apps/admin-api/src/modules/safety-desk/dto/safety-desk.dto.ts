// apps/admin-api/src/modules/safety-desk/dto/safety-desk.dto.ts · zod .strict() (PC-56 ADMIN-SWEEP-b3).
//
// NOTE WHAT IS ABSENT: no phone input anywhere (the b2 identity decision holds here with more force — a
// women_safety requester is the most protected person on this console), and the provider_pending honesty text is
// NOT a field — it is composed in the domain, so nobody can edit "nothing was sent" into a claim of delivery.
import { z } from 'zod';

export const QueryDeskSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export type QueryDeskDto = z.infer<typeof QueryDeskSchema>;

export const JoinSchema = z.object({}).strict();   // joining carries nothing; who joined is the token's fact
export type JoinDto = z.infer<typeof JoinSchema>;

export const RecordStepSchema = z.object({
  stepCode: z.string().min(1).max(40),
  /** who/what, mandatory for human steps (the domain enforces the floor with its own sentence). */
  detail: z.string().max(2000).optional(),
  /** emergency_vet steps may name the vet involved. */
  vetProfileId: z.string().uuid().optional(),
}).strict();
export type RecordStepDto = z.infer<typeof RecordStepSchema>;
