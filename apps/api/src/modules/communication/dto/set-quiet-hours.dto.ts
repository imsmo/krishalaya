// modules/communication/dto/set-quiet-hours.dto.ts · zod .strict() — a user's quiet-hours window.
// [PC-56 TENANT-8b · F-6 / F-22] `timezone` is OPTIONAL: blank means the cooperative's zone (`countries.timezone`), never
// the `'Asia/Kolkata'` literal this schema used to default to for every country. The registry check is the review's and
// the database's (`pg_timezone_names`, 0176's trigger) — a regex here would be a third, weaker, answer.
import { z } from 'zod';
const HHMM = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;     // anchored, ReDoS-safe
export const SetQuietHoursSchema = z.object({
  starts: z.string().regex(HHMM),
  ends: z.string().regex(HHMM),
  timezone: z.string().trim().min(1).max(64).optional(),
}).strict();
export type SetQuietHoursDto = z.infer<typeof SetQuietHoursSchema>;
/** The review's belt (shared/form-review `writerIssuesOf`): what the writer's schema would refuse, as review refusals. */
export const SetQuietHoursWriterSchema = SetQuietHoursSchema;
/** The review accepts anything typed — a review that 400s on a malformed time has nothing to print. */
export const PreviewQuietHoursSchema = z.object({
  starts: z.string().max(20).optional(), ends: z.string().max(20).optional(), timezone: z.string().max(64).optional(),
}).strict();
export type PreviewQuietHoursDto = z.infer<typeof PreviewQuietHoursSchema>;
export const PreviewLanguageSchema = z.object({ languageCode: z.string().max(16).optional() }).strict();
