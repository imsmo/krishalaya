// modules/ambassadors/dto/query-ambassador.dto.ts · zod .strict() — the W159 roster (admin; keyset).
// PC-56 TENANT-10a: `tier` (an ambassador_tier code), `inactive` (no recorded act in 60 days), `sort` (recent | owed).
import { z } from 'zod';
import { ROSTER_SORTS } from '../read-models/ambassador-roster.read-model';
const bool = z.union([z.boolean(), z.enum(['true', 'false', '1', '0'])]).transform((v) => v === true || v === 'true' || v === '1');
export const QueryAmbassadorsSchema = z.object({
  activeOnly: bool.optional(),
  tier: z.string().regex(/^[a-z_]{2,40}$/).optional(),
  inactive: bool.optional(),
  sort: z.enum(ROSTER_SORTS as unknown as [string, ...string[]]).default('recent'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryAmbassadorsDto = z.infer<typeof QueryAmbassadorsSchema>;

export const CandidateQuerySchema = z.object({ phone: z.string().trim().min(8).max(20) }).strict();
export type CandidateQueryDto = z.infer<typeof CandidateQuerySchema>;
