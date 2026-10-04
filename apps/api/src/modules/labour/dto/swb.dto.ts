// modules/labour/dto/swb.dto.ts · PC-56 TENANT-SW-b · zod .strict() bodies/queries for the attendance review desk (W165), the wage runs
// (W166) and worker advances. Every act body carries its reason; every money act requires an Idempotency-Key at the controller.
import { z } from 'zod';
import { EmployerConsentSchema } from './labour-act.dto';

export const ATTENDANCE_REVIEW_FILTERS = ['all', 'clean', 'needs_review', 'paper_backfill', 'unconfirmed_24h', 'confirmed', 'refused'] as const;
export const AttendanceReviewQuerySchema = z.object({
  status: z.enum(ATTENDANCE_REVIEW_FILTERS).default('all'),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type AttendanceReviewQueryDto = z.infer<typeof AttendanceReviewQuerySchema>;
/** vouch / refuse: the reason is what the next reader needs — 10–500 characters (the database CHECK is the same). */
export const AttendanceReviewSchema = z.object({ reason: z.string().trim().min(10).max(500) }).strict();
export const AttendanceConfirmSchema = z.preprocess((v) => v ?? {}, z.object({ reason: z.string().trim().min(3).max(300).optional() }).strict());
export const AttendanceBackfillSchema = z.object({
  assignmentId: z.string().uuid(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hoursRegular: z.number().min(0.5).max(12),
  hoursOvertime: z.number().min(0).max(8).default(0),
  mediaId: z.string().uuid(),
  reason: z.string().trim().min(10).max(500),
}).strict();
export type AttendanceBackfillDto = z.infer<typeof AttendanceBackfillSchema>;

export const WageHistorySchema = z.object({
  before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(14),
}).strict();
export type WageHistoryDto = z.infer<typeof WageHistorySchema>;

export const AdvanceRequestSchema = z.object({
  assignmentId: z.string().uuid(),
  amountMinor: z.string().regex(/^\d{1,15}$/),
  reason: z.string().trim().min(3).max(300),
}).strict();
export type AdvanceRequestDto = z.infer<typeof AdvanceRequestSchema>;
export const AdvanceApproveSchema = z.object({ reason: z.string().trim().min(3).max(300), consent: EmployerConsentSchema.optional() }).strict();
export type AdvanceApproveDto = z.infer<typeof AdvanceApproveSchema>;
export const AdvanceRejectSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();
export const ADVANCE_FILTERS = ['requested', 'outstanding', 'disbursed', 'recovering', 'recovered', 'rejected'] as const;
export const AdvanceListSchema = z.object({
  status: z.enum(ADVANCE_FILTERS).optional(),
  bookingId: z.string().uuid().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type AdvanceListDto = z.infer<typeof AdvanceListSchema>;
