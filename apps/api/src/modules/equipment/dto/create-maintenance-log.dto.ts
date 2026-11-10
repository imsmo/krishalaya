// modules/equipment/dto/create-maintenance-log.dto.ts · [PC-56 OPS-4b · OPS4-B7 / E11] the maintenance entry's body, STRICT (any other field → 422):
//   logType     one of the four the service knows (service | repair | breakdown | inspection);
//   costMinor   a non-negative minor-unit integer STRING as typed (bigint column; never a float);
//   engineHoursAt  scaled, one decimal at most, as typed (numeric(10,1)) — never a meter reading;
//   notes       trimmed, 1–500 characters;
//   performedOn a real calendar day `YYYY-MM-DD` (the service refuses one after the organisation's today, MAINTENANCE_DATE_IN_FUTURE).
// It was inline in equipment.controller.ts with no calendar check (a "2026-02-31" reached Postgres as a 500).
import { z } from 'zod';

export const MAINTENANCE_LOG_TYPES = ['service', 'repair', 'breakdown', 'inspection'] as const;
const isCalendarDay = (s: string) => {
  const [y, m, d] = s.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
export const MaintenanceLogSchema = z.object({
  logType: z.enum(MAINTENANCE_LOG_TYPES),
  costMinor: z.string().regex(/^\d{1,15}$/, 'cost: a non-negative whole number of minor units').optional(),
  notes: z.string().trim().min(1).max(500).optional(),
  engineHoursAt: z.string().regex(/^\d{1,9}(\.\d)?$/, 'engine hours: up to one decimal').optional(),
  performedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCalendarDay, 'performedOn: a real calendar day'),
}).strict();
export type MaintenanceLogDto = z.infer<typeof MaintenanceLogSchema>;
