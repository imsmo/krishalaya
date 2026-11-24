// modules/land-soil-weather/dto/query-weather-alert.dto.ts · zod .strict() weather alert browse (read-only, by region).
import { z } from 'zod';
export const QueryWeatherSchema = z.object({
  regionId: z.string().uuid(),
  activeOnly: z.coerce.boolean().prefault(true),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryWeatherDto = z.infer<typeof QueryWeatherSchema>;
