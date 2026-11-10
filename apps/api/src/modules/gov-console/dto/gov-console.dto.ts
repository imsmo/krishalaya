// modules/gov-console/dto/gov-console.dto.ts · PC-56 GOV-0 — the government realm's payloads (zod .strict()).
import { z } from 'zod';

const phone = z.string().min(8).max(20);
const DeviceSchema = z.object({
  fingerprint: z.string().min(8).max(200),
  platform: z.enum(['android', 'ios', 'web']).optional(),
  model: z.string().max(100).optional(),
  osVersion: z.string().max(40).optional(),
  appVersion: z.string().max(20).optional(),
  pushToken: z.string().max(300).optional(),
}).strict();

export const GovOtpSchema = z.object({ phone }).strict();
export type GovOtpDto = z.infer<typeof GovOtpSchema>;

/** Sign in to an authority: the phone + its OTP (+ the authority, when known) — OR the chooser's second step. */
export const GovVerifySchema = z.union([
  z.object({ phone, code: z.string().regex(/^\d{4,8}$/), authorityId: z.string().uuid().optional(), device: DeviceSchema.optional() }).strict(),
  z.object({ choiceToken: z.string().min(20).max(200), authorityId: z.string().uuid(), device: DeviceSchema.optional() }).strict(),
]);
export type GovVerifyDto = z.infer<typeof GovVerifySchema>;

export const GovRefreshSchema = z.object({ refreshToken: z.string().min(20).max(200) }).strict();
export type GovRefreshDto = z.infer<typeof GovRefreshSchema>;

export const GovTwoFactorSchema = z.object({
  challengeToken: z.string().min(20).max(200),
  code: z.string().regex(/^\d{6}$/).optional(),
  recoveryCode: z.string().min(10).max(20).optional(),
}).strict().refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), { message: 'send a 6-digit code OR a recovery code', path: ['code'] });
export type GovTwoFactorDto = z.infer<typeof GovTwoFactorSchema>;

export const GovEnrolSchema = z.object({ enrolToken: z.string().min(20).max(200) }).strict();
export type GovEnrolDto = z.infer<typeof GovEnrolSchema>;
export const GovEnrolConfirmSchema = z.object({ enrolToken: z.string().min(20).max(200), code: z.string().regex(/^\d{6}$/) }).strict();
export type GovEnrolConfirmDto = z.infer<typeof GovEnrolConfirmSchema>;

/** A role request: the person by phone, the role, the term (1–12 months — the service names a wrong one), the reason. */
export const GovMemberRequestSchema = z.object({
  phone, roleCode: z.string().min(1).max(60), termMonths: z.number().int(), reason: z.string().max(2000),
}).strict();
export type GovMemberRequestDto = z.infer<typeof GovMemberRequestSchema>;

export const GovReasonSchema = z.object({ reason: z.string().max(2000) }).strict();
export type GovReasonDto = z.infer<typeof GovReasonSchema>;

/** PC-56 GOV-2a · B1 (GOV-2 Q3-A): a farmer's DRAFT never reaches the authority — `draft` is not a status this realm can ask for (the
 *  repository and 0240's policy exclude it too; the policy is the wall). B4: the scheme filter (one of the authority's schemes; another
 *  authority's id simply matches nothing). The keyset is unchanged. */
export const GOV_VISIBLE_STATUSES = ['submitted', 'under_verification', 'clarification_needed', 'approved', 'rejected', 'disbursed', 'closed', 'appealed'] as const;
export const GovApplicationsQuerySchema = z.object({
  status: z.enum(GOV_VISIBLE_STATUSES).optional(),
  schemeId: z.string().uuid().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();
export type GovApplicationsQueryDto = z.infer<typeof GovApplicationsQuerySchema>;

/** PC-56 GOV-2a · B2 (GOV-2 Q2-A, Q1-A): one act on one application. `approve` carries NO amount (an unknown key is refused by .strict());
 *  `reject` needs a listed `reasonCode` AND a `note` (the sentence the farmer reads); `clarify` needs a `note`. The domain names each refusal. */
export const GovApplicationActSchema = z.object({
  act: z.enum(['verify', 'clarify', 'approve', 'reject']),
  reasonCode: z.string().max(40).optional(),
  note: z.string().max(2000).optional(),
}).strict();
export type GovApplicationActDto = z.infer<typeof GovApplicationActSchema>;
