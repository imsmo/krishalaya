// modules/labour/dto/create-labour-booking.dto.ts · zod .strict() employer "post a booking" payload.
// The employer supplies the demand type, skill, region + skill_level (used to resolve the statutory
// dignity floor), dates, and the OFFERED wage (minor-unit string, bigint). min_wage is NOT client-
// supplied — the service snapshots it from minimum_wages. wageOffered below the floor is rejected (422).
// PC-56 TENANT-11b (A7): the dignity declarations are writable — transport (with its pickup point + time), meals, toilet,
// drinking water, a woman supervisor on site — and the task's village label. A6: the labour desk posting FOR an employer
// sends `onBehalf` (the employer + their recorded consent to `post`).
import { z } from 'zod';
import { WAGE_KINDS, SKILL_LEVELS } from '../domain/labour.events';
import { EmployerConsentSchema } from './labour-act.dto';
const minorStr = z.string().regex(/^\d{1,15}$/, 'must be a positive integer (minor units)');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');
export const CreateBookingSchema = z.object({
  demandTypeCode: z.string().min(1).max(40),
  taskSkillId: z.string().uuid(),
  regionId: z.string().uuid(),                 // statutory floor region (state-level)
  skillLevel: z.enum(SKILL_LEVELS as unknown as [string, ...string[]]),
  workersNeeded: z.number().int().min(1).max(500),
  startDate: dateStr,
  endDate: dateStr,
  dailyHours: z.number().min(0.5).max(24).default(8),
  wageKind: z.enum(WAGE_KINDS as unknown as [string, ...string[]]).default('per_day'),
  wageOfferedMinor: minorStr,
  womenOnly: z.boolean().default(false),
  farmLat: z.number().min(-90).max(90),
  farmLng: z.number().min(-180).max(180),
  respondByHours: z.number().int().min(1).max(720).optional(),
  // P0-2 booking details (both optional): work start time-of-day + free-text special instructions to the worker.
  startTime: hhmm.optional(),
  notes: z.string().max(300).optional(),
  // PC-56 TENANT-11b · A7 — the declarations (worker-visible). A pickup time needs a pickup point.
  transportProvided: z.boolean().default(false),
  transportPickupPoint: z.string().trim().min(2).max(150).optional(),
  transportPickupTime: hhmm.optional(),
  mealsProvided: z.boolean().default(false),
  toiletConfirmed: z.boolean().default(false),
  drinkingWater: z.boolean().default(false),
  womanSupervisor: z.boolean().default(false),
  villageLabel: z.string().trim().min(2).max(120).optional(),
  // PC-56 TENANT-11b · A6 — posting FOR an employer (labour.desk) with their recorded consent.
  onBehalf: z.object({ employerUserId: z.string().uuid(), consent: EmployerConsentSchema }).strict().optional(),
}).strict()
  .refine((b) => !b.transportPickupTime || !!b.transportPickupPoint, { message: 'a pickup time needs a pickup point', path: ['transportPickupPoint'] })
  .refine((b) => !b.transportPickupPoint || b.transportProvided, { message: 'a pickup point is only for transport provided', path: ['transportProvided'] });
export type CreateBookingDto = z.infer<typeof CreateBookingSchema>;
