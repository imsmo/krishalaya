// modules/communication/dto/query-conversation.dto.ts · zod .strict() — list the caller's conversations (keyset).
import { z } from 'zod';
import { queryBoolean } from '../../../core/http/query-boolean';
import { CONTEXT_TYPES } from '../domain/messaging.events';
export const QueryConversationsSchema = z.object({
  contextType: z.enum(CONTEXT_TYPES as unknown as [string, ...string[]]).optional(),
  // KV-BL-031: filter to ONE context row (e.g. a single listing's inquiry threads). Requires contextType to be
  // meaningful (a bare contextId across all context types would cross-match unrelated aggregates by coincidence
  // of uuid), but we don't hard-require the pair here — the repository only applies contextId when both are
  // present, same permissive style as the rest of this schema.
  contextId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  // contract-gap P0-1: false ⇒ the inbox (default), true ⇒ the per-participant archive.
  // PC-56 HOTFIX-6 · B6: the strict parser — `?archived=false` is the inbox (z.coerce.boolean read it as the archive); an unknown spelling is refused.
  archived: queryBoolean().optional().default(false),
}).strict();
export type QueryConversationsDto = z.infer<typeof QueryConversationsSchema>;
