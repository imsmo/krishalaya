// modules/education/dto/schedule-live.dto.ts · PC-56 TENANT-7c · the live FORM as the writer receives it — one shape for
// the review and the write (7a's rule) — the list's query, and the act's body.
//
// The review body is LENIENT (strings, capped) so a typo is explained by name rather than refused by a validator; the
// writer schema is the same fields with the column widths, and `writerIssuesOf` reports what the writer would refuse
// as `TOO_LONG` / `VALUE_REJECTED` against the field. PC-26b's `ScheduleLiveSchema` (a channel id, an ISO instant in
// whatever zone the browser had) is gone: the chain carries what a person types — a date and a wall-clock time, which
// the DATABASE turns into an instant in the cooperative's own zone.
import { z } from 'zod';
import { LIVE_FORM_FIELDS } from '../domain/live-class-review';
import { LIVE_BOXES } from '../repositories/live-session.repository';
import { LIVE_STATUSES } from '../domain/creator.events';

const loose = z.string().max(600);
const shape = <T extends readonly string[]>(names: T, v: z.ZodTypeAny) => Object.fromEntries(names.map((n) => [n, v.optional()])) as Record<T[number], z.ZodOptional<z.ZodTypeAny>>;

export const LiveFormSchema = z.object({ ...shape(LIVE_FORM_FIELDS, loose) }).strict();
export type LiveFormDto = z.infer<typeof LiveFormSchema>;
export const PreviewLiveSchema = LiveFormSchema.extend({ id: z.string().max(80).optional() }).strict();
export type PreviewLiveDto = z.infer<typeof PreviewLiveSchema>;
export const LiveWriterSchema = z.object({
  courseId: z.string().max(40).optional(),
  title: z.string().min(1).max(250),
  date: z.string().max(10).optional(),
  time: z.string().max(5).optional(),
  durationMins: z.string().max(3).optional(),
  capacity: z.string().max(6).optional(),
  joinUrl: z.string().max(500).optional(),
  remind: z.string().max(5).optional(),
  clashAccepted: z.string().max(5).optional(),
}).strict();

export const QueryLiveSchema = z.object({
  box: z.enum(LIVE_BOXES).default('upcoming'),
  courseId: z.string().uuid().optional(),
  status: z.enum(LIVE_STATUSES).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryLiveDto = z.infer<typeof QueryLiveSchema>;

/** The act's body: the reason (3–300, the audit row's own words), the attendance count, the recording's media id. */
export const LiveActSchema = z.object({
  reason: z.string().min(1).max(400),
  count: z.string().max(8).optional(),
  mediaId: z.string().max(80).optional(),
}).strict();
export type LiveActDto = z.infer<typeof LiveActSchema>;
