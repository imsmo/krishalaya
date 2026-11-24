import { z } from 'zod';
// Buyer saves (favourites/watchlist) + saved searches. entityType is validated again in the domain
// against the allowed catalogue. The saved-search `query` is the same shape the discovery search accepts
// (text + filters), stored verbatim so the saved list can re-run it.
export const SaveItemSchema = z.object({
  entityType: z.enum(['listing', 'product', 'seller', 'worker', 'course']),
  entityId: z.string().uuid(),
}).strict();
export type SaveItemDto = z.infer<typeof SaveItemSchema>;

export const CreateSavedSearchSchema = z.object({
  name: z.string().min(1).max(150),
  query: z.record(z.string(), z.unknown()),                 // {text, categoryId, filters{}, sort} — stored as jsonb
  notifyNewMatches: z.boolean().optional(),
}).strict();
export type CreateSavedSearchDto = z.infer<typeof CreateSavedSearchSchema>;

// keyset cursor for the saved lists (created_at DESC, id DESC)
export const SavedQuerySchema = z.object({
  entityType: z.enum(['listing', 'product', 'seller', 'worker', 'course']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();
export type SavedQueryDto = z.infer<typeof SavedQuerySchema>;
