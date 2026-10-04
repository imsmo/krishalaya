// modules/identity/dto/verification-team.dto.ts · PC-56 TENANT-SW-c · request shapes for the desk's claims, conflicts, the team and 2FA.
import { z } from 'zod';
import { CONFLICT_RELATIONS, SKIP_REASONS } from '../domain/verification-team';

const reason = z.string().trim().min(10).max(500);
const uuid = z.string().uuid();

export const SkipClaimSchema = z.object({ reasonCode: z.enum(SKIP_REASONS), note: z.string().max(300).optional() }).strict();
export type SkipClaimDto = z.infer<typeof SkipClaimSchema>;

export const DeclareConflictSchema = z.object({
  memberUserId: uuid,
  relation: z.enum(CONFLICT_RELATIONS),
  relationNote: z.string().max(200).optional(),
  reason,
}).strict();
export type DeclareConflictDto = z.infer<typeof DeclareConflictSchema>;

export const InviteStaffSchema = z.object({
  phone: z.string().min(8).max(20),
  roleCode: z.string().min(2).max(50),
  deskIds: z.array(uuid).max(20).optional(),
  languageCode: z.enum(['en', 'hi', 'gu']).optional(),
  channel: z.string().max(20).optional(),
}).strict();
export type InviteStaffDto = z.infer<typeof InviteStaffSchema>;

export const AddStaffDirectlySchema = z.object({
  phone: z.string().min(8).max(20),
  fullName: z.string().trim().min(1).max(200).optional(),
  roleCode: z.string().min(2).max(50),
  deskIds: z.array(uuid).max(20).optional(),
  reason,
}).strict();
export type AddStaffDirectlyDto = z.infer<typeof AddStaffDirectlySchema>;

const device = z.object({
  fingerprint: z.string().min(8).max(200), platform: z.enum(['android', 'ios', 'web']).optional(), model: z.string().max(100).optional(),
  osVersion: z.string().max(40).optional(), appVersion: z.string().max(20).optional(), pushToken: z.string().max(300).optional(),
}).strict();

export const InviteLookupSchema = z.object({ tenantId: uuid, token: z.string().min(20).max(100) }).strict();
export type InviteLookupDto = z.infer<typeof InviteLookupSchema>;
export const AcceptInviteSchema = z.object({
  tenantId: uuid, token: z.string().min(20).max(100), phone: z.string().min(8).max(20), code: z.string().regex(/^\d{4,8}$/),
  fullName: z.string().trim().min(1).max(200).optional(), device: device.optional(),
}).strict();
export type AcceptInviteDto = z.infer<typeof AcceptInviteSchema>;

export const TotpCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
export type TotpCodeDto = z.infer<typeof TotpCodeSchema>;
export const DisableTwoFactorSchema = z.object({
  code: z.string().regex(/^\d{6}$/).optional(), recoveryCode: z.string().min(10).max(20).optional(), reason: z.string().max(500).optional(),
}).strict().refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), { message: 'send a 6-digit code OR a recovery code', path: ['code'] });
export type DisableTwoFactorDto = z.infer<typeof DisableTwoFactorSchema>;

export const TeamQuerySchema = z.object({ cursor: z.string().max(400).optional(), limit: z.coerce.number().int().min(1).max(100).default(25) }).strict();
export type TeamQueryDto = z.infer<typeof TeamQuerySchema>;
export const InvitesQuerySchema = z.object({ status: z.enum(['pending', 'accepted', 'expired', 'revoked']).optional(), cursor: z.string().max(400).optional(), limit: z.coerce.number().int().min(1).max(100).default(25) }).strict();
export type InvitesQueryDto = z.infer<typeof InvitesQuerySchema>;
export const MemberSearchSchema = z.object({ q: z.string().max(60).default('') }).strict();
