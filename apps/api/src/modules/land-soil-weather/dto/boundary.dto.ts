// modules/land-soil-weather/dto/boundary.dto.ts · PC-56 TENANT-12 · F-2 — the boundary field of a parcel write, judged by the ONE
// validator (`domain/geojson.ts`). `{}`, a Point, an open ring or a latitude of 91 is refused with its reason by name.
import { z } from 'zod';
import { validateBoundary } from '../domain/geojson';

export const BoundarySchema = z.unknown().superRefine((v, ctx) => {
  const verdict = validateBoundary(v);
  if (!verdict.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `BOUNDARY_${verdict.refusal}${verdict.at ? ` at ${verdict.at}` : ''}`, params: { refusal: verdict.refusal } });
});
