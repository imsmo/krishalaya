// modules/dairy/dto/query-dairy-insights.dto.ts · W172's range control (PC-56 TENANT-6e-1).
//
// The canon's control reads *"90d"*. It is a CLOSED SET rather than a free number, for the reason TENANT-5d gave and
// which is sharper here: every query behind this screen is a range over `milk_collections`, which is RANGE-partitioned
// by `collected_on`, and the window is what prunes it (Law 8). `?window=3650` is a request able to read a cooperative's
// entire history in one page load — exactly the shape Rule Zero refuses, because it is fine on a village society and
// ruinous on a district union's shared partitions.
import { z } from 'zod';
import { DEFAULT_INSIGHT_WINDOW, INSIGHT_WINDOWS } from '../domain/dairy-insights';

export const QueryDairyInsightsSchema = z.object({
  // Coerced because it arrives from a query string, then validated against the DOMAIN's own list so the API, the page
  // and the specs cannot disagree about which windows exist.
  window: z.coerce.number().int()
    .refine((n): n is (typeof INSIGHT_WINDOWS)[number] => (INSIGHT_WINDOWS as readonly number[]).includes(n), {
      message: `window must be one of ${INSIGHT_WINDOWS.join(', ')}`,
    })
    .default(DEFAULT_INSIGHT_WINDOW),
}).strict();

export type QueryDairyInsightsDto = z.infer<typeof QueryDairyInsightsSchema>;
