// apps/admin-api/src/modules/farmer360/dto/farmer360.dto.ts · zod .strict() (PC-56 ADMIN-SWEEP-b4).
//
// NOTE WHAT IS ABSENT: no phone search. The b2 channel-identity decision holds on the deepest per-person lens with
// the most force — search is by exact user id or by name, and a spec pins that no repository predicate touches a
// phone. Results come back masked; the phone on screen is display, not a key.
import { z } from 'zod';

export const SearchFarmersSchema = z.object({
  /** name substring (≥2 chars so a single letter cannot sweep the population) or an exact uuid */
  q: z.string().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(25).default(10),
}).strict();
export type SearchFarmersDto = z.infer<typeof SearchFarmersSchema>;

export const ExportProfileSchema = z.object({
  /** mandatory — the export lands in audit WITH a reason (W109); the floor lives in the domain. */
  reason: z.string().min(1).max(500),
}).strict();
export type ExportProfileDto = z.infer<typeof ExportProfileSchema>;
