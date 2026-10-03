// modules/land-soil-weather/dto/create-land-parcel.dto.ts · zod .strict() parcel registration payload.
// area is a decimal string (parsed to a scaled integer ×10000; no float). PC-56 TENANT-12 (F-2): the boundary is a GeoJSON
// Polygon / MultiPolygon judged by `domain/geojson.ts` — `{}` is refused.
import { z } from 'zod';
import { BoundarySchema } from './boundary.dto';
export const RegisterParcelSchema = z.object({
  regionId: z.string().uuid().optional(),
  surveyNo: z.string().max(60).optional(),
  bhulekhRef: z.string().max(120).optional(),
  areaValue: z.string().regex(/^\d{1,6}(\.\d{1,4})?$/, 'area, up to 4 decimals'),
  areaUnit: z.string().min(1).max(20).default('acre'),
  irrigationTypeCode: z.string().min(1).max(40).optional(),
  boundaryGeojson: BoundarySchema.optional(),
  isTenantFarmed: z.boolean().default(false),
}).strict();
export type RegisterParcelDto = z.infer<typeof RegisterParcelSchema>;
