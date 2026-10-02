// modules/requirements/dto/query-requirement.dto.ts · list/filter query params (cursor pagination, never OFFSET).
import { z } from 'zod';
import { REQUIREMENT_STATUSES } from '../domain/requirement.state';

// box=open → browse requirements still soliciting quotes (open | partially_matched; `status` narrows within that set);
// box=mine → the caller's own requirements (any status);
// box=all  → PC-56 TENANT-11d (A7): the tenant desk's board — EVERY requirement in this tenant, whoever posted it (tenant RLS
//            already confines it to this tenant's members), any status; requirement.desk or a moderator only.
// sort=need_by → W131's "Need by ▴" (need-by ascending, no need-by last), a real µs/date keyset; counts=1 → per-status counts.
export const REQUIREMENT_BOXES = ['open', 'mine', 'all'] as const;
export type RequirementBox = (typeof REQUIREMENT_BOXES)[number];

export const QueryRequirementsSchema = z.object({
  box: z.enum(REQUIREMENT_BOXES).default('open'),
  status: z.enum(REQUIREMENT_STATUSES).optional(),
  categoryId: z.string().uuid().optional(),
  sort: z.enum(['recent', 'need_by']).default('recent'),
  counts: z.enum(['1', 'true']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type QueryRequirementsDto = z.infer<typeof QueryRequirementsSchema>;
