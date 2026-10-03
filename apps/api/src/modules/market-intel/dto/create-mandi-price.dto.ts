// modules/market-intel/dto/create-mandi-price.dto.ts · zod .strict() — record a TENANT price observation (minor-string).
import { z } from 'zod';
const minor = z.string().regex(/^\d{1,15}$/);
export const IngestPriceSchema = z.object({
  mandiId: z.string().uuid().nullish(),
  regionId: z.string().uuid().nullish(),
  productId: z.string().uuid(),
  gradeOptionId: z.string().uuid().nullish(),
  priceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  minMinor: minor.nullish(),
  maxMinor: minor.nullish(),
  modalMinor: minor,
  unitCode: z.string().min(1).max(20).default('quintal'),
  arrivalsQty: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/).nullish(),
  // PC-56 TENANT-12 (F-4): the tenant API writes ONLY tenant observations. The source is FORCED to 'tenant_manual' by the service;
  // a caller that names any other source is refused here (a typed price is never 'agmarknet').
  source: z.literal('tenant_manual').optional(),
}).strict();
export type IngestPriceDto = z.infer<typeof IngestPriceSchema>;
