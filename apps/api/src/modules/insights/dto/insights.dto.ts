// modules/insights/dto/insights.dto.ts · PC-56 TENANT-SW-f — strict request shapes for W193–W196 (zod .strict(): an unknown key is a 422,
// never silently dropped). The report builder's From/To bound (≤ 92 days) is checked HERE as well as in the service and the database.
import { z } from 'zod';
import { MAX_RANGE_DAYS, MAX_DIMENSIONS, MAX_MEASURES, SCHEDULE_CADENCES } from '../domain/report-builder';
import { daysInclusive, isCivilDay } from '../domain/civil-days';

const Key = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);
const Day = z.string().refine(isCivilDay, 'a calendar day YYYY-MM-DD');
export const PageQuerySchema = z.object({ cursor: z.string().max(400).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).strict();
export const DemandQuerySchema = PageQuerySchema.extend({ reach: z.enum(['all', 'districts']).optional() }).strict();
export const DemandExportBodySchema = z.object({ reach: z.enum(['all', 'districts']).default('all') }).strict();
export const EmptyBodySchema = z.object({}).strict();
export const ReasonSchema = z.object({ reason: z.string().trim().min(10).max(500) }).strict();
/** W2826's "record a manual wastage event" — accepted as a shape only so it can be REFUSED BY NAME (MANUAL_WASTAGE_REFUSED). */
export const ManualWastageSchema = z.object({}).passthrough();

export const DefinitionBodySchema = z.object({
  title: z.string().trim().min(3).max(160),
  datasetCode: Key, dimensions: z.array(Key).max(MAX_DIMENSIONS).default([]), measures: z.array(Key).min(1).max(MAX_MEASURES),
  rangeDays: z.coerce.number().int().min(1).max(MAX_RANGE_DAYS),
}).strict();

export const RunBodySchema = z.object({
  definitionId: z.string().uuid().optional(),
  datasetCode: Key.optional(), dimensions: z.array(Key).max(MAX_DIMENSIONS).optional(), measures: z.array(Key).max(MAX_MEASURES).optional(),
  from: Day.optional(), to: Day.optional(),
}).strict()
  .refine((b) => !!b.definitionId || (!!b.datasetCode && (b.measures?.length ?? 0) > 0), { message: 'name a saved definition, or a dataset with at least one measure' })
  .refine((b) => (b.from === undefined) === (b.to === undefined), { message: 'From and To go together' });

/** THE 92-DAY BOUND at the edge — the controller calls this before the service (which checks again, and the database a third time). */
export function dtoRangeRefusal(b: { from?: string; to?: string }): 'RANGE_TOO_WIDE' | null {
  return b.from && b.to && b.to >= b.from && daysInclusive(b.from, b.to) > MAX_RANGE_DAYS ? 'RANGE_TOO_WIDE' : null;
}

export const ScheduleBodySchema = z.object({
  definitionId: z.string().uuid(), cadence: z.enum(SCHEDULE_CADENCES), weekdayIso: z.coerce.number().int().min(1).max(7).nullish(),
  monthDay: z.coerce.number().int().min(1).max(28).nullish(), timeIst: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), recipientRoles: z.array(z.string().max(40)).min(1).max(5),
}).strict();

export type PageQuery = z.infer<typeof PageQuerySchema>;
export type DemandQuery = z.infer<typeof DemandQuerySchema>;
export type DefinitionBody = z.infer<typeof DefinitionBodySchema>;
export type RunBody = z.infer<typeof RunBodySchema>;
export type ScheduleBody = z.infer<typeof ScheduleBodySchema>;
