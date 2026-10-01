// modules/cms/dto/create-banner.dto.ts · zod — PC-56 TENANT-8d · the banner FORM (both chains) and the acts.
//
// The FORM body is strings (the chain carries values in the URL; 6d-4). The words are per language — `headline_<l>`,
// `body_<l>`, `cta_<l>` — so the schema admits exactly those keys beside its own (a key of any other shape is refused by
// zod; a language the form does not offer is the review's `LANGUAGE_NOT_OFFERED`). `BannerWriterSchema` is what the
// writer would accept — the review runs it too (`writerIssuesOf`), so a value the writer refuses is a review refusal first.
// `expect` is the review's own content token, carried back so an edit a colleague overtook is a typed 409.
import { z } from 'zod';
import { BANNER_INTENTS, TEXT_FIELD_RE } from '../domain/banner-review';

const s = (max: number) => z.string().max(max).optional();
const BASE = {
  placement: s(80), mediaId: s(60), groupKey: s(120), targetUrl: s(600), roles: s(1200), regions: s(2000),
  startsDate: s(20), startsTime: s(10), endsDate: s(20), endsTime: s(10), reason: s(400),
  intent: z.enum(BANNER_INTENTS as unknown as [string, ...string[]]).default('new'),
  expect: s(80),
};
export const BannerFormSchema = z.object(BASE).catchall(z.string().max(600)).superRefine((o, ctx) => {
  for (const k of Object.keys(o)) {
    if (k in BASE) continue;
    if (!TEXT_FIELD_RE.test(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [k], message: 'unknown field' });
  }
});
export type BannerFormDto = z.infer<typeof BannerFormSchema>;

export const BannerWriterSchema = z.object({
  placement: z.string().min(1).max(80),
  mediaId: z.string().uuid(),
  groupKey: z.string().max(60).optional(),
  targetUrl: z.string().url().max(400).optional(),
  reason: z.string().min(3).max(300),
});

/** Every act's body: a reason (the audit row's sentence). */
export const BannerActSchema = z.object({ reason: z.string().max(400).default('') }).strict();
export type BannerActDto = z.infer<typeof BannerActSchema>;

export const SlotMoveSchema = z.object({ id: z.string().max(60), direction: z.enum(['up', 'down']), reason: z.string().max(400).default('') }).strict();
export type SlotMoveDto = z.infer<typeof SlotMoveSchema>;
