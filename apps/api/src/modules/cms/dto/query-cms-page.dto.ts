// modules/cms/dto/query-cms-page.dto.ts · zod .strict() — W175's list (keyset on the slug) and W177's FAQ list.
// Filters arrive from a GET form, so a blank select is `''` — read as "any", never refused.
import { z } from 'zod';
const opt = (max: number) => z.string().max(max).optional().transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));
export const QueryPagesSchema = z.object({
  pageKind: opt(30),
  state: opt(20),
  languageCode: opt(8),
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryPagesDto = z.infer<typeof QueryPagesSchema>;

export const QueryFaqSchema = z.object({ topic: opt(40), state: opt(20) }).strict();
export type QueryFaqDto = z.infer<typeof QueryFaqSchema>;
