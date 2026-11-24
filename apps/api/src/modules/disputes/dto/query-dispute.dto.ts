// modules/disputes/dto/query-dispute.dto.ts · list/filter query params (cursor pagination, never OFFSET).
import { z } from 'zod';
import { DISPUTE_STATUSES } from '../domain/dispute.state';

// box=raised → disputes I raised; against → disputes against me; all → tenant moderation view (needs dispute.resolve).
export const DISPUTE_BOXES = ['raised', 'against', 'all'] as const;
export type DisputeBox = (typeof DISPUTE_BOXES)[number];

export const QueryDisputesSchema = z.object({
  box: z.enum(DISPUTE_BOXES).prefault('raised'),
  status: z.enum(DISPUTE_STATUSES).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(20),
}).strict();
export type QueryDisputesDto = z.infer<typeof QueryDisputesSchema>;
