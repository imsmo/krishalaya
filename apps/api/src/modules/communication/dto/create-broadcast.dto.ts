// modules/communication/dto/create-broadcast.dto.ts · zod .strict() — the broadcast plane's bodies (PC-56 TENANT-8e).
// The SHAPE only: every business rule (the role registry, the words' bounds, the schedule in the cooperative's zone, the
// channel a provider must exist for) is the review's (`domain/broadcast-review.ts`), so a refusal is a sentence with a
// code, never a zod message. Strings are bounded so a review is never asked about a megabyte.
import { z } from 'zod';
import { BROADCAST_STATUSES } from '../domain/broadcast.state';

/** The form (W2841–W2844): the draft's words, audience, optional schedule, optional channel (refused unless inapp). */
export const BroadcastFormSchema = z.object({
  title: z.string().max(400).optional(),
  body: z.string().max(4000).optional(),
  audienceRoleCode: z.string().max(80).optional(),
  scheduledAt: z.string().max(40).optional(),     // YYYY-MM-DDTHH:MM in the cooperative's zone
  channel: z.string().max(20).optional(),
}).strict();
export type BroadcastFormDto = z.infer<typeof BroadcastFormSchema>;

/** The mutate chain (W2845–W2847): a reason, recorded word for word. */
export const BroadcastActSchema = z.object({ reason: z.string().max(600) }).strict();
export type BroadcastActDto = z.infer<typeof BroadcastActSchema>;

export const QueryBroadcastsSchema = z.object({
  status: z.enum(BROADCAST_STATUSES).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryBroadcastsDto = z.infer<typeof QueryBroadcastsSchema>;

export const BroadcastActsQuerySchema = z.object({ reason: z.string().max(600).optional() }).strict();

/** W2839 · the export's params: none — the file is the cooperative's whole broadcast history. */
export const BroadcastExportParamsSchema = z.object({}).strict();
export type BroadcastExportParams = z.infer<typeof BroadcastExportParamsSchema>;

/** W430 · the opt-in policy form. */
export const OptinPolicySchema = z.object({
  sources: z.array(z.string().max(60)).max(10).optional(),
  consentStatement: z.string().max(1200).optional(),
  expectVersion: z.coerce.number().int().min(1).optional(),
}).strict();
export type OptinPolicyDto = z.infer<typeof OptinPolicySchema>;
