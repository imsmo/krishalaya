// modules/cms/dto/query-banner.dto.ts · zod .strict() — PC-56 TENANT-8d · W173's GET-form filters, the live box, the slot move.
import { z } from 'zod';
import { BANNER_PHASES } from '../domain/banner-window';

const opt = (max: number) => z.string().max(max).optional();
/** W173: phase (live · scheduled · ended · draft · paused · archived), placement, language (has words in it); keyset. */
export const QueryBannersSchema = z.object({
  phase: z.enum(BANNER_PHASES as unknown as [string, ...string[]]).optional(),
  placement: opt(80),
  languageCode: opt(8),
  cursor: opt(200),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryBannersDto = z.infer<typeof QueryBannersSchema>;

/** The live box: what a member's app would be offered for a placement, in the member's language. */
export const LiveBannersSchema = z.object({ placement: opt(80), languageCode: opt(8), limit: z.coerce.number().int().min(1).max(50).default(20) }).strict();
export type LiveBannersDto = z.infer<typeof LiveBannersSchema>;

export const SlotPreviewSchema = z.object({ id: z.string().max(60), direction: z.enum(['up', 'down']), reason: opt(400) }).strict();
export type SlotPreviewDto = z.infer<typeof SlotPreviewSchema>;
