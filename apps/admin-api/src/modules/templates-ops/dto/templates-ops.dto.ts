// apps/admin-api/src/modules/templates-ops/dto/templates-ops.dto.ts · PC-56 ADMIN-11b. All `.strict()`.
import { z } from 'zod';

/** Twenty characters, the same floor as ADMIN-11's settings plane. A wording change on a platform default is sent to
 *  every user of every tenant that has not overridden it, and "typo" is not a record of a decision. */
const Reason = z.string().trim().min(20).max(2_000);

const EventCode = z.string().trim().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/).max(80);
/** The six channels `notification_templates.channel` carries. **There is no CHECK on that column in the schema** — it is
 *  a bare varchar(15) — so this enum is the only thing standing between the registry and a template on channel 'smsx'
 *  that nothing will ever send and nothing will ever flag. Recorded rather than silently relied upon. */
const Channel = z.enum(['push', 'sms', 'whatsapp', 'email', 'inapp', 'ivr']);
const Language = z.string().trim().toLowerCase().regex(/^[a-z]{2}(-[a-z]{2,8})?$/).max(8);

export const QueryTemplatesSchema = z.object({
  channel: Channel.optional(),
  languageCode: Language.optional(),
  eventCode: EventCode.optional(),
  platformOnly: z.coerce.boolean().optional(),
  cursor: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
export type QueryTemplatesDto = z.infer<typeof QueryTemplatesSchema>;

export const QueryCoverageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
}).strict();
export type QueryCoverageDto = z.infer<typeof QueryCoverageSchema>;

export const AuthorVersionSchema = z.object({
  eventCode: EventCode,
  channel: Channel,
  languageCode: Language,
  // NULL = the platform default. A tenant id here is refused outright for security copy, by this plane AND by a trigger.
  tenantId: z.string().uuid().nullish(),
  subject: z.string().trim().max(250).nullish(),
  // No upper bound tighter than the column: the SMS segment budget is enforced in the domain with the *rendered* length,
  // which is the only length that costs money. A character cap here would refuse a long WhatsApp body for an SMS reason.
  body: z.string().min(1).max(20_000),
  providerTemplateRef: z.string().trim().max(120).nullish(),
  reason: Reason,
}).strict();
export type AuthorVersionDto = z.infer<typeof AuthorVersionSchema>;

export const VersionActionSchema = z.object({ reason: Reason }).strict();
export type VersionActionDto = z.infer<typeof VersionActionSchema>;

export const ApproveVersionSchema = z.object({
  reason: Reason,
  // The author, for the second-person check, where the version does not record one (a row written by a path that
  // predates this plane). The version's own `authored_by_admin_id` wins when present — a caller-supplied author would
  // otherwise be a way to name yourself as somebody else and approve your own wording.
  authoredByAdminId: z.string().uuid().optional(),
}).strict();
export type ApproveVersionDto = z.infer<typeof ApproveVersionSchema>;

export const RegisterSenderSchema = z.object({
  channel: z.enum(['sms', 'whatsapp', 'email', 'ivr']),
  sender: z.string().trim().min(3).max(120),
  entityId: z.string().trim().max(60).nullish(),
  // **A SENDER ID IS A PER-COUNTRY REGULATORY OBJECT.** DLT is Indian; Bangladesh, Nepal and the UAE have their own
  // regimes. A registry without a country is a table that cannot cross a border.
  countryCode: z.string().trim().length(2).toUpperCase(),
  provider: z.string().trim().max(40).nullish(),
  note: z.string().trim().max(300).nullish(),
  reason: Reason,
}).strict();
export type RegisterSenderDto = z.infer<typeof RegisterSenderSchema>;
