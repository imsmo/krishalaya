// modules/identity/dto/auth.dto.ts · auth flow payloads (phone login is the primary path).
import { z } from 'zod';
const phone = z.string().min(8).max(20);

export const RequestOtpSchema = z.object({ phone, channel: z.enum(['sms','whatsapp','ivr']).default('sms') }).strict();
export type RequestOtpDto = z.infer<typeof RequestOtpSchema>;

const DeviceSchema = z.object({
  fingerprint: z.string().min(8).max(200),
  platform: z.enum(['android','ios','web']).optional(),
  model: z.string().max(100).optional(),
  osVersion: z.string().max(40).optional(),
  appVersion: z.string().max(20).optional(),
  pushToken: z.string().max(300).optional(),
}).strict();

export const VerifyOtpSchema = z.object({
  phone,
  code: z.string().regex(/^\d{4,8}$/),
  tenantId: z.string().uuid(),
  fullName: z.string().trim().min(1).max(200).optional(),  // captured on first-time registration
  device: DeviceSchema.optional(),
}).strict();
export type VerifyOtpDto = z.infer<typeof VerifyOtpSchema>;

export const RefreshSchema = z.object({ refreshToken: z.string().min(20).max(200), tenantId: z.string().uuid() }).strict();
export type RefreshDto = z.infer<typeof RefreshSchema>;

export const LogoutSchema = z.object({ allDevices: z.coerce.boolean().default(false) }).strict();
export type LogoutDto = z.infer<typeof LogoutSchema>;

export const ChangePhoneStartSchema = z.object({ newPhone: phone }).strict();
export type ChangePhoneStartDto = z.infer<typeof ChangePhoneStartSchema>;
export const ChangePhoneConfirmSchema = z.object({ newPhone: phone, code: z.string().regex(/^\d{4,8}$/) }).strict();
export type ChangePhoneConfirmDto = z.infer<typeof ChangePhoneConfirmSchema>;

/** PC-56 TENANT-SW-c · B3: finish a sign-in that is waiting for its second factor — a TOTP or ONE recovery code, never both. */
export const VerifyTwoFactorSchema = z.object({
  tenantId: z.string().uuid(),
  challengeToken: z.string().min(20).max(200),
  code: z.string().regex(/^\d{6}$/).optional(),
  recoveryCode: z.string().min(10).max(20).optional(),
}).strict().refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), { message: 'send a 6-digit code OR a recovery code', path: ['code'] });
export type VerifyTwoFactorDto = z.infer<typeof VerifyTwoFactorSchema>;
