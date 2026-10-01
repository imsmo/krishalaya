// modules/cms/dto/create-cms-page.dto.ts · zod .strict() — PC-56 TENANT-8c · the page FORM (all three chains).
//
// The FORM body is strings (the chain carries values in the URL; 6d-4). `PageWriterSchema` is what the writer would
// accept — the review runs it too (`writerIssuesOf`), so a value the writer refuses is a review refusal first.
// `intent` says which chain wrote it (`new` — New page / New FAQ entry; `version` — the editor's chain); `expect` is the
// review's own `mode:version` token, carried back so a write the review no longer describes is a typed 409 (F-20).
import { z } from 'zod';
import { PAGE_KINDS } from '../domain/cms.events';
import { PAGE_INTENTS } from '../domain/page-review';
import { BODY_MAX, SLUG_MAX, TITLE_MAX } from '../domain/page-rules';

const s = (max: number) => z.string().max(max).optional();
export const PageFormSchema = z.object({
  slug: s(200), pageKind: s(30), defaultTitle: s(300), body: s(BODY_MAX + 1000), languageCode: s(8), topic: s(40), reason: s(300),
  intent: z.enum(PAGE_INTENTS as unknown as [string, ...string[]]).default('version'),
  expect: s(40),
}).strict();
export type PageFormDto = z.infer<typeof PageFormSchema>;

export const PageWriterSchema = z.object({
  slug: z.string().min(1).max(SLUG_MAX),
  pageKind: z.enum(PAGE_KINDS as unknown as [string, ...string[]]),
  defaultTitle: z.string().min(1).max(TITLE_MAX),
  body: z.string().min(1).max(BODY_MAX),
  languageCode: z.string().min(2).max(8),
  topic: z.string().max(40).optional(),
  reason: z.string().min(3).max(300),
});

/** The acts' body: a reason always; an archive reason code for archive. */
export const PageActSchema = z.object({
  reason: z.string().max(400).default(''),
  archiveReason: z.string().max(40).optional(),
}).strict();
export type PageActDto = z.infer<typeof PageActSchema>;

/** The FAQ reorder act. */
export const FaqMoveSchema = z.object({
  slug: z.string().max(200),
  direction: z.enum(['up', 'down']),
  reason: z.string().max(400).default(''),
}).strict();
export type FaqMoveDto = z.infer<typeof FaqMoveSchema>;
