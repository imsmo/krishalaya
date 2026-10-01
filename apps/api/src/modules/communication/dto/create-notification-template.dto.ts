// modules/communication/dto/create-notification-template.dto.ts · zod .strict() — PC-56 TENANT-8a · the override form.
//
// The FORM body is strings (the chain carries values in the URL; 6d-4). `OverrideWriterSchema` is what the writer
// would accept — the review runs it too (`writerIssuesOf`), so a value the writer refuses is a review refusal first.
// PC-27's `UpsertTemplateSchema` (event × channel × language × body, an in-place upsert that never sent — F-1) is gone.
import { z } from 'zod';
import { NOTIF_CHANNELS } from '../domain/communication.events';

const s = (max: number) => z.string().max(max).optional();
export const OverrideFormSchema = z.object({
  eventCode: s(80), channel: s(15), languageCode: s(8), subject: s(250), body: s(4000), reason: s(300),
}).strict();
export type OverrideFormDto = z.infer<typeof OverrideFormSchema>;

export const OverrideWriterSchema = z.object({
  eventCode: z.string().min(1).max(80),
  channel: z.enum(NOTIF_CHANNELS as unknown as [string, ...string[]]),
  languageCode: z.string().min(2).max(8),
  subject: z.string().max(250).optional(),
  body: z.string().min(1).max(4000),
  reason: z.string().min(3).max(300),
});

export const OverrideActSchema = z.object({
  reason: z.string().max(400).default(''),
  versionId: z.string().max(40).optional(),
}).strict();
export type OverrideActDto = z.infer<typeof OverrideActSchema>;
