// apps/admin-api/src/modules/demand-map/dto/demand-map.dto.ts · (PC-56 ADMIN-SWEEP-c3)
import { z } from 'zod';

export const DemandWeekSchema = z.object({
  week: z.string().regex(/^\d{4}-W\d{2}$/).optional(),
}).strict();
export type DemandWeekDto = z.infer<typeof DemandWeekSchema>;

export const ExportDemandSchema = z.object({
  week: z.string().regex(/^\d{4}-W\d{2}$/).optional(),
  reason: z.string().min(1),   // the ≥10 floor is the domain's (assertExportReason) — one error text, one owner
}).strict();
export type ExportDemandDto = z.infer<typeof ExportDemandSchema>;
