// modules/dairy/dto/bmc.dto.ts · PC-56 TENANT-6d-1 · zod `.strict()` for the cooler's acts and its stream.
//
// Temperatures are ONE-DECIMAL STRINGS on the wire and integers in the domain. Not numbers: `4.5` over JSON is a
// double, and a band boundary that arrives as 4.499999999 is a breach on somebody's phone at 2am. The same reason
// every money field on this platform is a string.
import { z } from 'zod';
import { COMPRESSOR_STATES } from '../domain/bmc-unit.entity';

/** `-5.0` … `150.0`, one decimal place, as text. */
const tempC = z.string().regex(/^-?\d{1,3}(\.\d)?$/, 'temperature must be a number with at most one decimal, as a string');
/** Litres to two decimals, as text — the column is numeric(10,2). */
const litres = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'volume must be a number with at most two decimals, as a string');

export const RegisterBmcSchema = z.object({
  mccId: z.string().uuid(),
  capacityLitres: litres,
  /** Defaults live in the SERVICE (4.0 / 0.0 / 0.5) so a client that says nothing gets W170's own band. */
  targetTempC: tempC.optional(),
  minTempC: tempC.optional(),
  toleranceC: z.string().regex(/^\d(\.\d)?$/, 'tolerance must be 0.0..5.0 as a string').optional(),
  /** The sensor. Optional: a cooler read by a thermometer and a notebook is still a cooler this platform can hold. */
  iotDeviceRef: z.string().min(1).max(100).optional(),
  model: z.string().min(1).max(100).optional(),
  serialNo: z.string().min(1).max(100).optional(),
}).strict();
export type RegisterBmcDto = z.infer<typeof RegisterBmcSchema>;

export const SetBmcBandSchema = z.object({
  minTempC: tempC,
  targetTempC: tempC,
  toleranceC: z.string().regex(/^\d(\.\d)?$/),
}).strict();
export type SetBmcBandDto = z.infer<typeof SetBmcBandSchema>;

export const ReportBmcLevelSchema = z.object({
  volumeLitres: litres,
  /** When the level was seen. Omitted means now — a level is not a backfillable record. */
  at: z.string().datetime().optional(),
}).strict();
export type ReportBmcLevelDto = z.infer<typeof ReportBmcLevelSchema>;

export const StateCompressorSchema = z.object({
  state: z.enum(COMPRESSOR_STATES as unknown as [string, ...string[]]),
}).strict();
export type StateCompressorDto = z.infer<typeof StateCompressorSchema>;

/**
 * A reading. EXACTLY ONE identifier, checked here as well as in the service: a payload carrying both a sensor
 * reference and a unit id is a gateway that is not sure which tank it is talking about, and a monitor built on
 * "prefer one silently" is a chart of the wrong cooler.
 */
export const RecordBmcReadingSchema = z.object({
  deviceRef: z.string().min(1).max(100).optional(),
  unitId: z.string().uuid().optional(),
  tempC,
  humidityPct: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).optional(),
  /** The sensor's OWN time. Buffered readings arrive late and must keep the moment they were taken (W170's gap card). */
  recordedAt: z.string().datetime().optional(),
}).strict().refine((v) => (v.deviceRef ? 1 : 0) + (v.unitId ? 1 : 0) === 1, {
  message: 'a reading must name exactly one of deviceRef or unitId',
});
export type RecordBmcReadingDto = z.infer<typeof RecordBmcReadingSchema>;

export const QueryBmcMonitorSchema = z.object({
  /** Which tank's chart to draw. Omitted lets the monitor choose the one that needs looking at. */
  unitId: z.string().uuid().optional(),
  /** W170 draws six. 1..168 so a week can be reviewed after an incident. */
  hours: z.coerce.number().int().min(1).max(168).default(6),
}).strict();
export type QueryBmcMonitorDto = z.infer<typeof QueryBmcMonitorSchema>;

export const QueryBmcUnitsSchema = z.object({
  mccId: z.string().uuid().optional(),
  includeRetired: z.coerce.boolean().default(false),
}).strict();
export type QueryBmcUnitsDto = z.infer<typeof QueryBmcUnitsSchema>;
