// apps/admin-api/src/modules/moderation-queue/dto/moderation-queue.dto.ts · zod .strict() (PC-56 ADMIN-5f).
//
// NOTE WHAT IS ABSENT: no request carries a VALUE AT STAKE. It is computed server-side from the listing row, because
// the figure decides whether a second signature is required and a client that could supply it could supply ₹99,999.
import { z } from 'zod';

const Reason = z.string().min(1).max(2000);
const Source = z.enum(['fraud_flag', 'reported', 'regulated_category', 'spot_audit']);
const Lang = z.string().min(2).max(8);
const Cursor = z.string().max(200).optional();

export const HoldSchema = z.object({
  source: Source,
  sourceRef: z.string().uuid().nullish(),
  /** Sent to the farmer. The length floor lives in the domain so the refusal explains what the sentence is for. */
  reason: Reason,
  languageCode: Lang,
}).strict();
export type HoldDto = z.infer<typeof HoldSchema>;

export const ReleaseSchema = z.object({
  source: Source.optional(),
  sourceRef: z.string().uuid().nullish(),
  reason: Reason,
  languageCode: Lang,
  /** So the reporter hears the outcome. W092: "Reporters hear back on every report — even dismissals." */
  reporterUserId: z.string().uuid().nullish(),
}).strict();
export type ReleaseDto = z.infer<typeof ReleaseSchema>;

export const RemoveSchema = z.object({
  source: Source.optional(),
  sourceRef: z.string().uuid().nullish(),
  reason: Reason,
  languageCode: Lang,
  reporterUserId: z.string().uuid().nullish(),
  checkerNote: z.string().max(2000).nullish(),
}).strict();
export type RemoveDto = z.infer<typeof RemoveSchema>;

export const QueryHeldSchema = z.object({
  cursor: Cursor,
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type QueryHeldDto = z.infer<typeof QueryHeldSchema>;

export const QueryReportsSchema = z.object({
  subjectType: z.enum(['listing', 'review', 'message', 'user']).optional(),
  cursor: Cursor,
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type QueryReportsDto = z.infer<typeof QueryReportsSchema>;

export const DecideReportSchema = z.object({
  status: z.enum(['actioned', 'dismissed']),
  outcome: z.enum(['hidden', 'removed', 'warned', 'none']).optional(),
  /** Told to the reporter. A dismissal with no words is the outcome most likely to be read as contempt. */
  outcomeNote: z.string().min(1).max(2000),
  languageCode: Lang,
}).strict();
export type DecideReportDto = z.infer<typeof DecideReportSchema>;
