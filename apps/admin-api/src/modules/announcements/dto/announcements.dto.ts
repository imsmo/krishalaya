// apps/admin-api/src/modules/announcements/dto/announcements.dto.ts · zod .strict() request schemas (reject unknown
// keys → no mass-assignment). Title/body are length-bounded here and PLAIN-TEXT-validated in the domain (no HTML).
// Every consequential mutation carries a reason (audit/§4). Schedule windows are ISO; validated in the domain.
import { z } from 'zod';
import { ANNOUNCEMENT_STATUSES } from '../domain/announcement.state';
import { SEVERITIES, PLACEMENTS, MAX_PLANS, MAX_COUNTRIES } from '../domain/content';

const Reason = z.string().min(3).max(1000);
const Cursor = z.string().max(200).optional();
const Limit = z.coerce.number().int().min(1).max(100).prefault(50);
const PlanCode = z.string().regex(/^[a-z0-9_]{1,40}$/);
const CountryCode = z.string().regex(/^[A-Z]{2}$/);

export const QueryAnnouncementsSchema = z.object({
  status: z.enum(ANNOUNCEMENT_STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  cursor: Cursor,
  limit: Limit,
}).strict();
export type QueryAnnouncementsDto = z.infer<typeof QueryAnnouncementsSchema>;

export const QueryChangesSchema = z.object({ cursor: Cursor, limit: Limit }).strict();
export type QueryChangesDto = z.infer<typeof QueryChangesSchema>;

export const CreateAnnouncementSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  severity: z.enum(SEVERITIES).prefault('info'),
  placement: z.enum(PLACEMENTS).prefault('banner'),
  plans: z.array(PlanCode).max(MAX_PLANS).prefault([]),
  countries: z.array(CountryCode).max(MAX_COUNTRIES).prefault([]),
  reason: Reason,
}).strict();
export type CreateAnnouncementDto = z.infer<typeof CreateAnnouncementSchema>;

export const UpdateAnnouncementSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  severity: z.enum(SEVERITIES),
  placement: z.enum(PLACEMENTS),
  plans: z.array(PlanCode).max(MAX_PLANS).prefault([]),
  countries: z.array(CountryCode).max(MAX_COUNTRIES).prefault([]),
  reason: Reason,
}).strict();
export type UpdateAnnouncementDto = z.infer<typeof UpdateAnnouncementSchema>;

export const ScheduleAnnouncementSchema = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  reason: Reason,
}).strict();
export type ScheduleAnnouncementDto = z.infer<typeof ScheduleAnnouncementSchema>;

// publish/expire/archive — reason only (publish uses the already-set schedule; or pass an endsAt to publish-now).
export const PublishAnnouncementSchema = z.object({
  endsAt: z.string().datetime().optional(),   // required if the announcement has no end date yet (publish-now)
  reason: Reason,
}).strict();
export type PublishAnnouncementDto = z.infer<typeof PublishAnnouncementSchema>;

export const LifecycleReasonSchema = z.object({ reason: Reason }).strict();
export type LifecycleReasonDto = z.infer<typeof LifecycleReasonSchema>;
