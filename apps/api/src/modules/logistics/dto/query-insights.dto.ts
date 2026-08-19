// modules/logistics/dto/query-insights.dto.ts · W244's range control (PC-56 TENANT-5d).
//
// The canon's control reads "90 days". It is a CLOSED SET rather than a number: every query behind this screen is
// bounded by the window and prunes `shipments`/`shipment_events` partitions with it (Law 8), so an arbitrary
// `?window=3650` would be a question the indexes cannot serve and the partition pruning cannot help — one request
// able to read a tenant's entire history is exactly the shape Rule Zero refuses.
import { z } from 'zod';
import { DEFAULT_INSIGHT_WINDOW, INSIGHT_WINDOWS } from '../domain/logistics-desk';

export const QueryInsightsSchema = z.object({
  // Coerced because it arrives from a query string; validated against the domain's own list so the API and the
  // console cannot disagree about which windows exist.
  window: z.coerce.number().int().refine((n): n is (typeof INSIGHT_WINDOWS)[number] => (INSIGHT_WINDOWS as readonly number[]).includes(n), {
    message: `window must be one of ${INSIGHT_WINDOWS.join(', ')}`,
  }).default(DEFAULT_INSIGHT_WINDOW),
}).strict();

export type QueryInsightsDto = z.infer<typeof QueryInsightsSchema>;
