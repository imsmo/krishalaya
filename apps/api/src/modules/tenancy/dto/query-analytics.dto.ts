// modules/tenancy/dto/query-analytics.dto.ts · zod .strict() analytics window query (optional ISO dates).
import { z } from 'zod';
export const QueryAnalyticsSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  currency: z.string().length(3).prefault('INR'),
}).strict();
export type QueryAnalyticsDto = z.infer<typeof QueryAnalyticsSchema>;
