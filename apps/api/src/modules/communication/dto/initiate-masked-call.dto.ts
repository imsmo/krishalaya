// modules/communication/dto/initiate-masked-call.dto.ts · zod .strict() — initiate a privacy-proxy call.
// PC-56 HOTFIX-6 · B1 (survey STORE-4 F-1, founder D2): the body names a CONVERSATION, never a person. `calleeUserId` is GONE — the server
// resolves the other participant (MaskedCallService); a client that still sends it, or a context of its own, is refused by `.strict()`
// (the house validation answer, 422 VALIDATION_FAILED). The Idempotency-Key travels in the header (the body's optional `idempotencyKey` is
// accepted for a client that cannot set headers; the header wins).
import { z } from 'zod';
export const InitiateMaskedCallSchema = z.object({
  conversationId: z.string().uuid(),
  idempotencyKey: z.string().min(1).max(120).optional(),
}).strict();
export type InitiateMaskedCallDto = z.infer<typeof InitiateMaskedCallSchema>;
