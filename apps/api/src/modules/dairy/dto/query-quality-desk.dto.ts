// modules/dairy/dto/query-quality-desk.dto.ts · W168's only inputs (PC-56 TENANT-6b-2).
// A pure read with two optional knobs: which day's cycle to show, and which cycle length to derive. Both optional
// because the honest default comes from the DATABASE (its calendar day) and from the MEMBERS (their own
// `payment_cycle` preference) — the same defaults TENANT-6a's counter board takes, through the same function, so the
// two dairy screens can never disagree about which fortnight is running.
import { z } from 'zod';
import { PAYMENT_CYCLES } from '../domain/dairy.events';

export const QueryQualityDeskSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cycle: z.enum(PAYMENT_CYCLES as unknown as [string, ...string[]]).optional(),
}).strict();
export type QueryQualityDeskDto = z.infer<typeof QueryQualityDeskSchema>;
