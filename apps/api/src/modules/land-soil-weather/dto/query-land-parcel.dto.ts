// modules/land-soil-weather/dto/query-land-parcel.dto.ts · zod .strict() parcel list query (µs keyset — PC-56 TENANT-12, F-10).
import { z } from 'zod';
export const QueryParcelsSchema = z.object({
  box: z.enum(['mine', 'all']).default('mine'),
  regionId: z.string().uuid().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryParcelsDto = z.infer<typeof QueryParcelsSchema>;
