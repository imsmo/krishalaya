// modules/tenant-webhooks/dto/create-webhook.dto.ts · zod .strict() DTOs — PC-56 TENANT-13a. The wire shape only; every rule a person
// can break (guard verdict, catalogue membership, email, reason length) is judged by domain/webhook-rules.ts so the review page and the
// write refuse with the SAME codes. Anchored regexes; bounded lengths.
import { z } from 'zod';

const EVENT = z.string().regex(/^[a-z][a-z0-9_.]{1,59}$/);
const REASON = z.string().max(400).optional();

export const CreateWebhookSchema = z.object({
  url: z.string().max(600),
  eventTypes: z.array(EVENT).max(60),
  developerEmail: z.string().max(300),
}).strict();
export type CreateWebhookDto = z.infer<typeof CreateWebhookSchema>;

export const PreviewWebhookSchema = z.object({
  url: z.string().max(600).optional(),
  eventTypes: z.array(EVENT).max(60).optional(),
  developerEmail: z.string().max(300).optional(),
}).strict();
export type PreviewWebhookDto = z.infer<typeof PreviewWebhookSchema>;

export const UpdateWebhookSchema = z.object({
  eventTypes: z.array(EVENT).min(1).max(60),
  reason: REASON,
}).strict();
export type UpdateWebhookDto = z.infer<typeof UpdateWebhookSchema>;

export const ReasonSchema = z.object({ reason: REASON }).strict();
export type ReasonDto = z.infer<typeof ReasonSchema>;

export const DELIVERY_STATUS_FILTERS = ['all', 'failed', 'delivered', 'held', 'pending'] as const;
export const QueryDeliveriesSchema = z.object({
  endpointId: z.string().uuid().optional(),
  status: z.enum(DELIVERY_STATUS_FILTERS).optional(),
  since: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type QueryDeliveriesDto = z.infer<typeof QueryDeliveriesSchema>;
