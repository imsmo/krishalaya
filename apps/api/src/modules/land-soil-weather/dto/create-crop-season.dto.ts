// modules/land-soil-weather/dto/create-crop-season.dto.ts · zod .strict() crop season + lifecycle payloads.
// yields are decimal strings (parsed to scaled integers ×1000; no float). PC-56 TENANT-12 (F-9): a yield is never stored
// without its unit — `yieldUnitCode` (a mass unit from `units`) is required whenever a yield is given (the service checks the
// class; 0190's CHECK is the floor). (F-19) `abandon` takes its reason inside the .strict() contract, never a loose body field.
import { z } from 'zod';
import { CROP_SEASONS } from '../domain/land-soil-weather.events';
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const yieldStr = z.string().regex(/^\d{1,11}(\.\d{1,3})?$/, 'yield, up to 3 decimals');
const unitCode = z.string().regex(/^[a-z_]{1,20}$/);
export const PlanCropSeasonSchema = z.object({
  parcelId: z.string().uuid(),
  productId: z.string().uuid(),
  season: z.enum(CROP_SEASONS as unknown as [string, ...string[]]),
  year: z.number().int().min(2000).max(2100),
  sownOn: dateStr.optional(),
  expectedHarvest: dateStr.optional(),
  expectedYield: yieldStr.optional(),
  yieldUnitCode: unitCode.optional(),
}).strict().refine((o) => o.expectedYield === undefined || o.yieldUnitCode !== undefined, { message: 'YIELD_UNIT_REQUIRED', path: ['yieldUnitCode'] });
export type PlanCropSeasonDto = z.infer<typeof PlanCropSeasonSchema>;

export const SowCropSeasonSchema = z.object({ sownOn: dateStr }).strict();
export type SowCropSeasonDto = z.infer<typeof SowCropSeasonSchema>;
export const HarvestCropSeasonSchema = z.object({ actualYield: yieldStr.optional(), yieldUnitCode: unitCode.optional() }).strict();
export type HarvestCropSeasonDto = z.infer<typeof HarvestCropSeasonSchema>;
export const AbandonCropSeasonSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();
export type AbandonCropSeasonDto = z.infer<typeof AbandonCropSeasonSchema>;
