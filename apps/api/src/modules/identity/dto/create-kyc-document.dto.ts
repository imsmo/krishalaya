import { z } from 'zod';
export const SubmitKycSchema = z.object({
  roleId: z.string().uuid().optional(),
  docTypeId: z.string().uuid(),
  mediaId: z.string().uuid(),
  docNoMasked: z.string().max(50).optional(),
  issuedBy: z.string().max(150).optional(),
  validFrom: z.string().date().optional(),
  validUntil: z.string().date().optional(),
}).strict();
export type SubmitKycDto = z.infer<typeof SubmitKycSchema>;

export const ReviewKycSchema = z.object({
  decision: z.enum(['verify','reject']),
  reason: z.string().max(500).optional(),
  // [PC-56 TENANT-9a] the coded ground (`kyc_decision_reason`); a free-text-only rejection is filed under `other`.
  reasonCode: z.string().max(60).optional(),
}).strict().refine((v) => v.decision !== 'reject' || (v.reason && v.reason.length > 0) || Boolean(v.reasonCode), { message: 'reason required when rejecting' });
export type ReviewKycDto = z.infer<typeof ReviewKycSchema>;

// ---------------------------------------------------------------------------------------------- PC-56 TENANT-9a · the desk
// Shapes only — every rule is the review's (`buildSubmitReview`) or the act's (`actVerdict`), so a refusal is a named code,
// never a zod 400 with nothing to show on the form-error screen.
const optStr = (n: number) => z.string().max(n).optional().nullable();
export const DeskSubmitSchema = z.object({
  subjectKind: optStr(20), userId: optStr(40), docTypeCode: optStr(80), roleCode: optStr(50), mediaId: optStr(40),
  docNoMasked: optStr(200), issuedBy: optStr(400), validFrom: optStr(20), validUntil: optStr(20),
}).strict();
export type DeskSubmitDto = z.infer<typeof DeskSubmitSchema>;

export const DeskActSchema = z.object({ reasonCode: optStr(60), note: optStr(2000) }).strict();
export type DeskActDto = z.infer<typeof DeskActSchema>;

export const DeskQueueSchema = z.object({
  subjectKind: z.enum(['user', 'organisation']).optional(),
  roleCode: z.string().max(50).regex(/^[a-z_]+$/).optional(),
  status: z.enum(['pending', 'verified', 'rejected', 'expired']).optional(),
  docTypeCode: z.string().max(80).regex(/^[a-z_]+$/).optional(),
  expiringWithin: z.coerce.number().int().min(0).max(365).optional(),
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type DeskQueueDto = z.infer<typeof DeskQueueSchema>;
