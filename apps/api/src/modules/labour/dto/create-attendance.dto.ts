// modules/labour/dto/create-attendance.dto.ts · zod .strict() worker clock-in payload (PRD §31.12).
// The device sends ONLY its raw GPS fix; the server resolves the booking's farm coordinates and computes
// the great-circle distance itself (domain/geo.ts) — the fence is NEVER trusted to the client.
import { z } from 'zod';
export const ClockInSchema = z.object({
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
}).strict();
export type ClockInDto = z.infer<typeof ClockInSchema>;

// Clock-out (P0-9): the SERVER stamps clock_out_at = now() and computes hours/overtime; the client may only
// declare the unpaid break it took (capped at one day). Time/hours are NEVER trusted to the client.
export const ClockOutSchema = z.object({
  breakMinutes: z.number().int().min(0).max(24 * 60).prefault(0),
}).strict();
export type ClockOutDto = z.infer<typeof ClockOutSchema>;

// Employer dual-confirm (P0-9): confirm a specific clocked-out day for an assignment. ISO 'YYYY-MM-DD'.
export const ConfirmAttendanceSchema = z.object({
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'workDate must be YYYY-MM-DD'),
}).strict();
export type ConfirmAttendanceDto = z.infer<typeof ConfirmAttendanceSchema>;
