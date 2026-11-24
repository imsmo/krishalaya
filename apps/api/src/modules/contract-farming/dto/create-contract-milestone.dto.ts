// modules/contract-farming/dto/create-contract-milestone.dto.ts · zod .strict() milestone record + complete.
import { z } from 'zod';
import { MILESTONE_TYPES } from '../domain/contract-farming.events';
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const RecordMilestoneSchema = z.object({
  growerId: z.string().uuid().optional(),
  milestoneType: z.enum(MILESTONE_TYPES as unknown as [string, ...string[]]),
  dueOn: dateStr.optional(),
  data: z.record(z.string(), z.unknown()).prefault({}),
}).strict();
export type RecordMilestoneDto = z.infer<typeof RecordMilestoneSchema>;

export const CompleteMilestoneSchema = z.object({
  evidenceMediaId: z.string().uuid().optional(),
  data: z.record(z.string(), z.unknown()).prefault({}),
}).strict();
export type CompleteMilestoneDto = z.infer<typeof CompleteMilestoneSchema>;
