// apps/admin-api/src/modules/consent-ops/dto/consent-ops.dto.ts · zod .strict() request schemas.
// Notice text length and shape are validated in the DOMAIN, not here, so the 422 can explain WHY a 25-character notice
// is a toggle label rather than a notice — "String must contain at least 40 character(s)" teaches an operator to pad.
import { z } from 'zod';

const Reason = z.string().min(3).max(1000);
const Cursor = z.string().max(200).optional();
const PurposeCode = z.string().regex(/^[a-z][a-z0-9_]{1,59}$/);

export const QueryConsentsSchema = z.object({
  purposeCode: PurposeCode.optional(),
  channel: z.string().max(30).optional(),
  withdrawnOnly: z.string().max(5).optional(),
  cursor: Cursor,
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryConsentsDto = z.infer<typeof QueryConsentsSchema>;

export const OpenDraftSchema = z.object({
  changeReason: Reason,
  /** Changing whether a purpose is MANDATORY is a version-level decision, not a live toggle: a farmer who agreed while it
   *  was compulsory did not give it freely, and flipping the flag under them would silently re-describe their consent. */
  isMandatory: z.boolean().optional(),
}).strict();
export type OpenDraftDto = z.infer<typeof OpenDraftSchema>;

export const SaveNoticeSchema = z.object({
  languageCode: z.string().min(2).max(8),
  noticeText: z.string().min(1).max(4000),
  toggleLabel: z.string().min(1).max(150),
}).strict();
export type SaveNoticeDto = z.infer<typeof SaveNoticeSchema>;

export const PublishConsentVersionSchema = z.object({
  checkerNote: z.string().min(1).max(1000).optional(),
}).strict();
export type PublishConsentVersionDto = z.infer<typeof PublishConsentVersionSchema>;

export const DiscardConsentDraftSchema = z.object({ reason: Reason }).strict();
export type DiscardConsentDraftDto = z.infer<typeof DiscardConsentDraftSchema>;
