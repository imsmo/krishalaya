// apps/admin-api/src/modules/translations/dto/translations.dto.ts · zod .strict() (PC-56 ADMIN-3b).
// Every mutation carries a mandatory reason, as the whole catalogue plane does since 0041.
import { z } from 'zod';

const Reason = z.string().min(10).max(1000);
const Lang = z.string().min(2).max(8);

export const QueryQueueSchema = z.object({
  languageCode: Lang.optional(),
  entityType: z.string().max(40).optional(),
  cursor: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();
export type QueryQueueDto = z.infer<typeof QueryQueueSchema>;

/** A HUMAN translation. `isMachine` is not accepted from a caller here: a person using this endpoint is authoring, and
 *  letting them mark their own work machine-generated would let a human draft bypass the review rule by claiming to be
 *  something it is not. Machine rows arrive only through the run path. */
export const CreateTranslationSchema = z.object({
  entityType: z.string().min(3).max(40),
  entityId: z.string().uuid(),
  field: z.string().min(2).max(60),
  languageCode: Lang,
  text: z.string().min(1).max(4000),
  reason: Reason,
}).strict();
export type CreateTranslationDto = z.infer<typeof CreateTranslationSchema>;

export const ReviewTranslationSchema = z.object({
  decision: z.enum(['approve', 'approve_with_edit', 'reject']),
  text: z.string().max(4000).nullish(),
  note: z.string().max(2000).nullish(),
}).strict();
export type ReviewTranslationDto = z.infer<typeof ReviewTranslationSchema>;

export const RevokeTranslationSchema = z.object({ reason: Reason }).strict();
export type RevokeTranslationDto = z.infer<typeof RevokeTranslationSchema>;

export const GrantReviewerSchema = z.object({
  adminUserId: z.string().uuid(),
  languageCode: Lang,
  note: z.string().max(2000).nullish(),
  reason: Reason,
}).strict();
export type GrantReviewerDto = z.infer<typeof GrantReviewerSchema>;

export const RevokeReviewerSchema = z.object({ reason: Reason }).strict();
export type RevokeReviewerDto = z.infer<typeof RevokeReviewerSchema>;

/** A machine-translation run. Bounded arrays: a request naming forty entity kinds is not a considered request. */
export const RequestRunSchema = z.object({
  entityTypes: z.array(z.string().min(3).max(40)).min(1).max(8),
  languageCodes: z.array(Lang).min(1).max(14),
  reason: Reason,
}).strict();
export type RequestRunDto = z.infer<typeof RequestRunSchema>;

/** The taxonomy export (ADMIN-3-Q2). A window is NOT required here, unlike the support exports: a taxonomy is a current
 *  state rather than a stream of events, and "the categories as they are now" is exactly the useful export. */
export const TaxonomyExportSchema = z.object({
  report: z.string().min(3).max(40),
  languageCode: Lang.optional(),
  limit: z.coerce.number().int().min(1).max(20000).optional(),
}).strict();
export type TaxonomyExportDto = z.infer<typeof TaxonomyExportSchema>;
