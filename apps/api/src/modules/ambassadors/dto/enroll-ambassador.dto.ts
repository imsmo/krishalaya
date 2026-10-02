// modules/ambassadors/dto/enroll-ambassador.dto.ts · zod .strict() — admin enrolls/updates an ambassador.
// PC-56 TENANT-10a: the recruit is named by PHONE (the console's form) or, for API callers, by userId — exactly one. The
// review schemas take the form's raw entries (every value an optional string) so a mistyped value is answered with its
// refusal rather than a validator's 400 (W2481: "every invalid field is listed with its reason").
import { z } from 'zod';
const minor = z.string().regex(/^\d{1,15}$/);
const reason = z.string().trim().min(3).max(300);
export const EnrollAmbassadorSchema = z.object({
  userId: z.string().uuid().optional(),
  phone: z.string().trim().min(8).max(20).optional(),
  clusterRegionIds: z.array(z.string().uuid()).max(3).default([]),
  tierId: z.string().uuid().nullish(),
  mentorAmbassadorId: z.string().uuid().nullish(),
  kioskEnabled: z.boolean().default(false),
  aepsEnabled: z.boolean().default(false),
  monthlyStipendMinor: minor.default('0'),
}).strict().refine((v) => (v.userId ? 1 : 0) + (v.phone ? 1 : 0) === 1, { message: 'name the recruit by exactly one of phone or userId' });
export type EnrollAmbassadorDto = z.infer<typeof EnrollAmbassadorSchema>;

export const UpdateAmbassadorSchema = z.object({
  clusterRegionIds: z.array(z.string().uuid()).max(3).optional(),
  tierId: z.string().uuid().nullish(),
  mentorAmbassadorId: z.string().uuid().nullish(),
  kioskEnabled: z.boolean().optional(),
  aepsEnabled: z.boolean().optional(),
  monthlyStipendMinor: minor.optional(),
  trainingCompleted: z.boolean().optional(),
  reason: reason.optional(),
}).strict();
export type UpdateAmbassadorDto = z.infer<typeof UpdateAmbassadorSchema>;

const loose = z.string().max(200).optional();
export const ReviewRecruitSchema = z.object({
  phone: loose, tierId: loose, mentorAmbassadorId: loose, monthlyStipendMinor: loose,
  clusterRegionIds: z.array(z.string().max(80)).max(10).optional(),
  kioskEnabled: z.boolean().optional(), aepsEnabled: z.boolean().optional(),
}).strict();
export type ReviewRecruitDto = z.infer<typeof ReviewRecruitSchema>;
export const ReviewEditSchema = ReviewRecruitSchema.omit({ phone: true }).extend({ trainingCompleted: z.boolean().optional() }).strict();
export type ReviewEditDto = z.infer<typeof ReviewEditSchema>;

/** Suspend REQUIRES a reason; reinstate takes one optionally (F-12). */
export const SuspendSchema = z.object({ reason }).strict();
export const ReinstateSchema = z.object({ reason: reason.optional() }).strict();
/** A payout (one ambassador, or the weekly run) REQUIRES a reason (A2 / A13). */
export const PayoutSchema = z.object({ reason }).strict();
/** Activating a referral accrues commission — a reason is required (F-12). */
export const ActivateReferralSchema = z.object({ reason }).strict();
