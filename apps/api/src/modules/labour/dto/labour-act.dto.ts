// modules/labour/dto/labour-act.dto.ts · PC-56 TENANT-11b · zod .strict() bodies for the acts the labour desk and the employer
// perform on a booking: the employer's RECORDED consent (A6 — the desk never acts for an employer without one), confirm
// roster (A3), cancel with a reason from the lookup (A7), and the pay run's optional reason.
import { z } from 'zod';

/** The employer's consent for ONE act the desk performs for them. voice / written carry evidence media; otp is the check. */
export const EmployerConsentSchema = z.object({
  channel: z.enum(['voice', 'otp', 'written']),
  mediaId: z.string().uuid().optional(),
  note: z.string().max(500).optional(),
}).strict().refine((c) => c.channel === 'otp' || !!c.mediaId, { message: 'a voice or written consent needs its evidence media', path: ['mediaId'] });
export type EmployerConsentDto = z.infer<typeof EmployerConsentSchema>;

export const ConfirmRosterSchema = z.object({
  reason: z.string().trim().min(3).max(300).optional(),
  consent: EmployerConsentSchema.optional(),
}).strict();
export type ConfirmRosterDto = z.infer<typeof ConfirmRosterSchema>;

export const CancelBookingSchema = z.object({
  reasonCode: z.string().regex(/^[a-z_]{2,40}$/),
  reasonText: z.string().trim().min(3).max(300).optional(),
  consent: EmployerConsentSchema.optional(),
}).strict();
export type CancelBookingDto = z.infer<typeof CancelBookingSchema>;

/** start / complete / pay: an optional reason (recorded on the audit row when given). */
export const BookingActSchema = z.object({
  reason: z.string().trim().min(3).max(300).optional(),
}).strict();
export type BookingActDto = z.infer<typeof BookingActSchema>;

/** A body that may be absent (an SDK call with no body arrives as undefined or {}): parsed as the empty act. */
export const OptionalBookingActSchema = z.preprocess((v) => v ?? {}, BookingActSchema);
export const OptionalConfirmRosterSchema = z.preprocess((v) => v ?? {}, ConfirmRosterSchema);
