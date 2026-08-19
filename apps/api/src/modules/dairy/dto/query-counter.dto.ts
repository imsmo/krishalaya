// modules/dairy/dto/query-counter.dto.ts · W167's controls (PC-56 TENANT-6a).
//
// A day, a shift, and optionally which cycle window to accrue over. The day is a DATE (`milk_collections` is
// partitioned by it, so it is also the pruning key) and the shift is 0007's own two-value vocabulary — a third value
// would be a board over rows that cannot exist.
import { z } from 'zod';
import { MILK_SHIFTS, PAYMENT_CYCLES } from '../domain/dairy.events';

export const QueryCounterSchema = z.object({
  // Omitted means "the database's today", resolved server-side: a console in one timezone and a counter stamping
  // current_date in another must not disagree about which day a pour belongs to.
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  shift: z.enum(MILK_SHIFTS).default('morning'),
  // Omitted means the tenant's most common membership preference — the cycle the dairy secretary is working to.
  cycle: z.enum(PAYMENT_CYCLES).optional(),
}).strict();

export type QueryCounterDto = z.infer<typeof QueryCounterSchema>;
