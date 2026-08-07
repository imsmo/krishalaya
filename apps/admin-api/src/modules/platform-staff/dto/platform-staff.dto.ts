// apps/admin-api/src/modules/platform-staff/dto/platform-staff.dto.ts · PC-56 ADMIN-9. All `.strict()`.
import { z } from 'zod';

/** Every reason on this plane is read months later by somebody deciding whether to readmit an operator or lift a
 *  restriction. Ten characters is not a formality — it is the difference between "exit" and "left on 7 Aug; access
 *  removed before the exit conversation per policy". */
const Reason = z.string().trim().min(10).max(2_000);

export const QueryOperatorsSchema = z.object({
  status: z.enum(['active', 'suspended']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type QueryOperatorsDto = z.infer<typeof QueryOperatorsSchema>;

export const SuspendOperatorSchema = z.object({ reason: Reason }).strict();
export type SuspendOperatorDto = z.infer<typeof SuspendOperatorSchema>;

export const RequestReinstateSchema = z.object({ reason: Reason }).strict();
export type RequestReinstateDto = z.infer<typeof RequestReinstateSchema>;

export const RestrictSchema = z.object({
  // Not an enum: the catalogue has 57 codes and grows with every wave, and a zod enum duplicated from
  // `owner-roles.ts` would be a second list to forget to update. The DOMAIN checks membership against the live
  // catalogue and refuses an unknown code — one source, checked once.
  permissionCode: z.string().trim().min(1).max(80),
  reason: Reason,
  // A restriction may be time-boxed. W438 shows a "90-day pilot" on an override, which is the same instinct pointed the
  // other way: a temporary measure that has to be remembered to be ended will outlive its reason.
  expiresAt: z.string().datetime().optional(),
}).strict();
export type RestrictDto = z.infer<typeof RestrictSchema>;

export const LiftRestrictionSchema = z.object({ reason: Reason }).strict();
export type LiftRestrictionDto = z.infer<typeof LiftRestrictionSchema>;

/** Five characters, not ten: "lost device" is a complete answer to "why are you revoking this session", and W439's own
 *  placeholder suggests exactly that. A suspension's reason has to survive a month; a session revoke has to survive
 *  the afternoon. */
export const RevokeSessionSchema = z.object({ reason: z.string().trim().min(5).max(2_000) }).strict();
export type RevokeSessionDto = z.infer<typeof RevokeSessionSchema>;

export const SetAccessPolicySchema = z.object({
  // Bounded on both sides. A one-day dormancy line would lock out anybody who takes a weekend; a 3,650-day suspend line
  // is the policy switched off while appearing to be configured.
  dormantAfterDays: z.number().int().min(1).max(365),
  suspendAfterDays: z.number().int().min(2).max(730),
  touchIntervalSec: z.number().int().min(0).max(3_600),
  reason: Reason,
}).strict();
export type SetAccessPolicyDto = z.infer<typeof SetAccessPolicySchema>;

export const QueryMatrixSchema = z.object({
  group: z.string().trim().min(1).max(40).optional(),
}).strict();
export type QueryMatrixDto = z.infer<typeof QueryMatrixSchema>;
