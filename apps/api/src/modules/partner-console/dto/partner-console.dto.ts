// modules/partner-console/dto/partner-console.dto.ts · PC-56 PARTNER-0 — the partner realm's payloads (zod .strict(); money = bigint minor strings).
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

export const PartnerOtpSchema = z.object({ phone }).strict();
export type PartnerOtpDto = z.infer<typeof PartnerOtpSchema>;

/** Sign in to the partner: the phone + its OTP (+ the partner, when the caller already knows it) — OR the chooser's second step. */
export const PartnerVerifySchema = z.union([
  z.object({ phone, code: z.string().regex(/^\d{4,8}$/), partnerId: z.string().uuid().optional(), device: DeviceSchema.optional() }).strict(),
  z.object({ choiceToken: z.string().min(20).max(200), partnerId: z.string().uuid(), device: DeviceSchema.optional() }).strict(),
]);
export type PartnerVerifyDto = z.infer<typeof PartnerVerifySchema>;

export const PartnerRefreshSchema = z.object({ refreshToken: z.string().min(20).max(200) }).strict();
export type PartnerRefreshDto = z.infer<typeof PartnerRefreshSchema>;

export const PartnerTwoFactorSchema = z.object({
  challengeToken: z.string().min(20).max(200),
  code: z.string().regex(/^\d{6}$/).optional(),
  recoveryCode: z.string().min(10).max(20).optional(),
}).strict().refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), { message: 'send a 6-digit code OR a recovery code', path: ['code'] });
export type PartnerTwoFactorDto = z.infer<typeof PartnerTwoFactorSchema>;

export const PartnerTotpCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
export type PartnerTotpCodeDto = z.infer<typeof PartnerTotpCodeSchema>;

export const PartnerApplicationsQuerySchema = z.object({
  status: z.enum(['submitted', 'under_review', 'approved', 'rejected', 'withdrawn', 'disbursed']).optional(),
  reviewQueue: z.enum(['true', 'false']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();
export type PartnerApplicationsQueryDto = z.infer<typeof PartnerApplicationsQuerySchema>;

const minorStr = z.string().regex(/^\d{1,15}$/, 'must be a positive integer (minor units)');
export const PartnerApproveSchema = z.object({ amountApprovedMinor: minorStr, coolingOffHours: z.number().int().min(0).max(720).default(24) }).strict();
export type PartnerApproveDto = z.infer<typeof PartnerApproveSchema>;
export const PartnerRejectSchema = z.object({ note: z.string().max(500).optional() }).strict();
export type PartnerRejectDto = z.infer<typeof PartnerRejectSchema>;

export const PartnerInviteSchema = z.object({
  phone,
  roleCode: z.enum(['partner_admin', 'partner_checker', 'partner_maker', 'partner_viewer']),
  languageCode: z.enum(['en', 'hi', 'gu']).optional(),
}).strict();
export type PartnerInviteDto = z.infer<typeof PartnerInviteSchema>;
export const PartnerReasonSchema = z.object({ reason: z.string().max(500) }).strict();
export type PartnerReasonDto = z.infer<typeof PartnerReasonSchema>;

export const PartnerAcceptInviteSchema = z.object({
  token: z.string().min(20).max(100),
  phone,
  code: z.string().regex(/^\d{4,8}$/),
  fullName: z.string().trim().min(1).max(200).optional(),
  device: DeviceSchema.optional(),
}).strict();
export type PartnerAcceptInviteDto = z.infer<typeof PartnerAcceptInviteSchema>;

// ── PC-56 PARTNER-1b ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** D4: the invite lookup is a POST — the token travels in the BODY, never in a URL (a URL lands in access logs and proxies). */
export const PartnerInviteLookupSchema = z.object({ token: z.string().min(20).max(100) }).strict();
export type PartnerInviteLookupDto = z.infer<typeof PartnerInviteLookupSchema>;

/** D1: revoke one of this partner's keys — the reason's 20–300 rule is the service's (a short reason is a 422 by name, not a 400). */
export const PartnerKeyRevokeSchema = z.object({ reason: z.string().max(2000) }).strict();
export type PartnerKeyRevokeDto = z.infer<typeof PartnerKeyRevokeSchema>;

/** D2: the deliveries list — keyset, newest first; filters endpoint / state (the rail's states) / event type; limit ≤ 100. */
export const PartnerDeliveriesQuerySchema = z.object({
  endpointId: z.string().uuid().optional(),
  state: z.enum(['pending', 'retrying', 'delivered', 'held', 'exhausted', 'cancelled']).optional(),
  eventType: z.string().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();
export type PartnerDeliveriesQueryDto = z.infer<typeof PartnerDeliveriesQuerySchema>;

// ── PC-56 PARTNER-2a ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The insurer's book — keyset, newest first; the status filter is the policy state machine's own list; limit ≤ 100. */
export const PartnerPoliciesQuerySchema = z.object({
  status: z.enum(['proposed', 'active', 'lapsed', 'cancelled', 'expired', 'claimed']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();
export type PartnerPoliciesQueryDto = z.infer<typeof PartnerPoliciesQuerySchema>;

// ── PC-56 PARTNER-2b ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The issuance queue — keyset, newest first, limit ≤ 100. NO status parameter: the queue is `proposed` by construction (founder Q5). */
export const PartnerIssuanceQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();
export type PartnerIssuanceQueryDto = z.infer<typeof PartnerIssuanceQuerySchema>;

// ── PC-56 PARTNER-3a ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The insurer's claims queue — keyset, OLDEST first; the status filter is the claim state machine's own list; limit ≤ 100. */
export const PartnerClaimsQuerySchema = z.object({
  status: z.enum(['intimated', 'docs_pending', 'survey_scheduled', 'surveyed', 'approved', 'partially_approved', 'rejected', 'paid', 'closed']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();
export type PartnerClaimsQueryDto = z.infer<typeof PartnerClaimsQuerySchema>;
/** The claims counts' window — two IST calendar days [from, to), both or neither (neither = the current FY, answered by the database). */
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const PartnerClaimCountsQuerySchema = z.object({ from: isoDay.optional(), to: isoDay.optional() }).strict()
  .refine((q) => (q.from === undefined) === (q.to === undefined), { message: 'from and to are given together, or neither' });
export type PartnerClaimCountsQueryDto = z.infer<typeof PartnerClaimCountsQuerySchema>;

// ── PC-56 PARTNER-4a ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The lender's own book — keyset, NEWEST first; the status filter is the FIVE statuses the platform can produce (`transferred` has no
 *  writer and is refused by name — asking for it is a 422 from zod, never an empty page that implies the state exists); limit ≤ 100. */
export const PartnerLoansQuerySchema = z.object({
  status: z.enum(['active', 'overdue', 'restructured', 'closed', 'written_off']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();
export type PartnerLoansQueryDto = z.infer<typeof PartnerLoansQuerySchema>;
/** The loan counts' window — two IST calendar days [from, to), both or neither (neither = the current FY, answered by the database). */
export const PartnerLoanCountsQuerySchema = z.object({ from: isoDay.optional(), to: isoDay.optional() }).strict()
  .refine((q) => (q.from === undefined) === (q.to === undefined), { message: 'from and to are given together, or neither' });
export type PartnerLoanCountsQueryDto = z.infer<typeof PartnerLoanCountsQuerySchema>;
/** One loan's repayment history — a limit only. There is no channel filter: the channel is not on the axis at all (0231). */
export const PartnerLoanRepaymentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
}).strict();
export type PartnerLoanRepaymentsQueryDto = z.infer<typeof PartnerLoanRepaymentsQuerySchema>;
