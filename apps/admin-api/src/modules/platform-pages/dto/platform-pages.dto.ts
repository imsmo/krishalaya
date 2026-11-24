// apps/admin-api/src/modules/platform-pages/dto/platform-pages.dto.ts · PC-56 LEGAL-1. All `.strict()`.
import { z } from 'zod';

/** Twenty characters — the settings / templates planes' floor. The words of a legal page bind every buyer and seller on the platform, and
 *  "typo" is not a record of a decision. */
const Reason = z.string().trim().min(20).max(2_000);
const Language = z.string().trim().toLowerCase().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/).max(8);
const Translation = z.object({
  languageCode: Language,
  title: z.string().max(1_000).nullish(),
  body: z.string().max(200_000),
}).strict();

export const CreateDraftSchema = z.object({
  title: z.string().max(1_000),
  body: z.string().max(200_000),
  /** the language the body is WRITTEN in; default = the slug's latest version's language */
  languageCode: Language.optional(),
  translations: z.array(Translation).max(20).optional(),
  reason: Reason,
}).strict();
export type CreateDraftDto = z.infer<typeof CreateDraftSchema>;

export const EditDraftSchema = z.object({
  title: z.string().max(1_000).optional(),
  body: z.string().max(200_000).optional(),
  /** replaces the version's translation set; omitted = unchanged */
  translations: z.array(Translation).max(20).optional(),
  reason: Reason,
  expectUpdatedAt: z.string().datetime({ offset: true }).optional(),
}).strict();
export type EditDraftDto = z.infer<typeof EditDraftSchema>;

export const PublishSchema = z.object({ reason: Reason }).strict();
export type PublishDto = z.infer<typeof PublishSchema>;

export const ArchiveSchema = z.object({
  reason: Reason,
  archiveReason: z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/),
}).strict();
export type ArchiveDto = z.infer<typeof ArchiveSchema>;
