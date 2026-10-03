// modules/land-soil-weather/dto/update-land-parcel.dto.ts · zod .strict() parcel patch. PC-56 TENANT-12: the boundary is judged by
// `domain/geojson.ts` (F-2); `reason` is REQUIRED by the service when the editor is not the owner (the land desk, `land.admin`,
// F-11) and is written to the audit row.
import { z } from 'zod';
import { BoundarySchema } from './boundary.dto';
export const UpdateParcelSchema = z.object({
  regionId: z.string().uuid().optional(),
  surveyNo: z.string().max(60).optional(),
  bhulekhRef: z.string().max(120).optional(),
  irrigationTypeCode: z.string().min(1).max(40).optional(),
  boundaryGeojson: BoundarySchema.optional(),
  isTenantFarmed: z.boolean().optional(),
  reason: z.string().trim().min(3).max(300).optional(),
}).strict().refine((o) => Object.keys(o).filter((k) => k !== 'reason').length > 0, { message: 'at least one field required' });
export type UpdateParcelDto = z.infer<typeof UpdateParcelSchema>;
