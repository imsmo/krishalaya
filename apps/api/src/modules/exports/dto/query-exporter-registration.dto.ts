// modules/exports/dto/query-exporter-registration.dto.ts · zod .strict() exporter list query (keyset).
import { z } from 'zod';
export const QueryExportersSchema = z.object({
  box: z.enum(['mine', 'all']).prefault('mine'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryExportersDto = z.infer<typeof QueryExportersSchema>;
