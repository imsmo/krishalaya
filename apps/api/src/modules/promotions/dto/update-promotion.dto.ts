// modules/promotions/dto/update-promotion.dto.ts · zod .strict() pause/resume payload.
// PC-56 TENANT-10b · B6 / F-7: the SDK sent `{ active }` against this strict `{ isActive }` (every call 400'd); the shape is
// unchanged and the SDK now sends it. A REASON is required (3–300) — the mutate chain's audit row carries it (F-12).
import { z } from 'zod';
export const SetPromotionActiveSchema = z.object({ isActive: z.boolean(), reason: z.string().trim().min(3).max(300) }).strict();
export type SetPromotionActiveDto = z.infer<typeof SetPromotionActiveSchema>;
