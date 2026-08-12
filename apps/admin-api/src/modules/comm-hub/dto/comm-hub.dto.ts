// apps/admin-api/src/modules/comm-hub/dto/comm-hub.dto.ts · zod .strict() (PC-56 ADMIN-SWEEP-b2).
//
// NOTE WHAT IS ABSENT, and it is the wave's precondition: NO ROUTE HERE TAKES A PHONE NUMBER. The hub joins threads
// on users.id (0133's channel-identity decision); a phone-search parameter in a god-mode console would be the
// cross-tenant sweep that decision refuses. "Next in queue" carries nothing at all — which ticket you get is the
// queue's decision (worst first-response deadline), not a request parameter.
import { z } from 'zod';

export const QueryHubSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export type QueryHubDto = z.infer<typeof QueryHubSchema>;

export const TakeNextSchema = z.object({}).strict();
export type TakeNextDto = z.infer<typeof TakeNextSchema>;

export const PresenceSchema = z.object({
  status: z.enum(['available', 'break']),
}).strict();
export type PresenceDto = z.infer<typeof PresenceSchema>;
