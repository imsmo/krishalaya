// apps/admin-api/src/modules/partner-ops/dto/partner-ops.dto.ts · PC-56 PARTNER-1a. All `.strict()`.
import { z } from 'zod';
import { PARTNER_OPS_REASON_MIN, SLA_DECISION_HOURS_MAX } from '../domain/partner-ops.rules';

/** The reason rule lives on THIS ONE LINE and nowhere else — the service does not re-check it. */
const Reason = z.string().trim().min(PARTNER_OPS_REASON_MIN).max(2_000);

export const SetPartnerSlaSchema = z.object({
  decisionHours: z.number().int().min(1).max(SLA_DECISION_HOURS_MAX).nullable(),
  reason: Reason,
}).strict();
export type SetPartnerSlaDto = z.infer<typeof SetPartnerSlaSchema>;

export const InvitePartnerAdminSchema = z.object({
  phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
  reason: Reason,
  languageCode: z.enum(['en', 'hi', 'gu']).optional(),
}).strict();
export type InvitePartnerAdminDto = z.infer<typeof InvitePartnerAdminSchema>;
