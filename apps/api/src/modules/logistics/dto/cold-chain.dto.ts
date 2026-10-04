// modules/logistics/dto/cold-chain.dto.ts · the manual reading, the trail query, thresholds, breach acts, loggers (zod .strict).
// Temperatures are physical decimals (NOT money).
//
// PC-56 TENANT-SW-e · F-13: the manual reading carries NO band and NO time. `.strict()` refuses `allowedMinC`, `allowedMaxC` and
// `recordedAt` by name (VALIDATION_FAILED, unrecognized keys) — the band is the threshold store's and the time is the server's.
import { z } from 'zod';
import { COLD_CHAIN_SUBJECTS } from '../domain/cold-chain-log.entity';
import { BREACH_OUTCOMES, BUYER_DECISIONS } from '../domain/logistics-ops';

const Temp = z.number().min(-60).max(80);

export const RecordColdChainSchema = z.object({
  subjectType: z.enum(COLD_CHAIN_SUBJECTS),
  subjectId: z.string().uuid(),
  tempC: Temp,
  humidityPct: z.number().min(0).max(100).nullable().optional(),
  deviceRef: z.string().trim().min(1).max(100).nullable().optional(),
}).strict();
export type RecordColdChainDto = z.infer<typeof RecordColdChainSchema>;

export const QueryColdChainSchema = z.object({
  subjectType: z.enum(COLD_CHAIN_SUBJECTS),
  subjectId: z.string().uuid(),
  breachOnly: z.coerce.boolean().default(false),
  since: z.string().datetime().optional(),            // recorded_at lower bound (partition prune)
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();
export type QueryColdChainDto = z.infer<typeof QueryColdChainSchema>;

export const ThresholdSchema = z.object({
  subjectType: z.enum(COLD_CHAIN_SUBJECTS), subjectId: z.string().uuid(), minC: Temp, maxC: Temp, reason: z.string().trim().min(10).max(500),
}).strict().refine((d) => d.minC <= d.maxC, { message: 'minC must be <= maxC', path: ['minC'] });
export type ThresholdDto = z.infer<typeof ThresholdSchema>;

export const SubjectQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(24 * 31).default(48),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
}).strict();
export type SubjectQueryDto = z.infer<typeof SubjectQuerySchema>;

/** W240: 12 months by default; `hours` is KEPT for the older reader (web-ops' device page) and narrows the window. */
export const BreachListSchema = z.object({
  hours: z.coerce.number().int().min(1).max(24 * 400).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
export type BreachListDto = z.infer<typeof BreachListSchema>;

export const BreachActSchema = z.object({
  note: z.string().trim().max(500).optional(),
  outcome: z.enum(BREACH_OUTCOMES).optional(),
  reason: z.string().trim().max(500).optional(),
  lossMinor: z.string().regex(/^[1-9]\d{0,14}$/).nullable().optional(),
  lossCurrency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
}).strict();
export type BreachActDto = z.infer<typeof BreachActSchema>;

export const BuyerDecisionSchema = z.object({ decision: z.enum(BUYER_DECISIONS), reason: z.string().trim().max(500).nullable().optional() }).strict();
export type BuyerDecisionDto = z.infer<typeof BuyerDecisionSchema>;

export const RegisterLoggerSchema = z.object({ serial: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{2,79}$/), label: z.string().trim().max(120).nullable().optional() }).strict();
export type RegisterLoggerDto = z.infer<typeof RegisterLoggerSchema>;
export const IssueKeySchema = z.object({ subjectType: z.enum(COLD_CHAIN_SUBJECTS), subjectId: z.string().uuid(), reason: z.string().trim().min(10).max(500) }).strict();
export type IssueKeyDto = z.infer<typeof IssueKeySchema>;
export const RevokeKeySchema = z.object({ reason: z.string().trim().min(10).max(500) }).strict();

/** The device's reading body (the ingest route). Signed together with the timestamp and nonce headers. */
export const DeviceReadingSchema = z.object({
  tempC: Temp,
  humidityPct: z.number().min(0).max(100).nullable().optional(),
  recordedAt: z.string().datetime(),                 // the DEVICE's own time (buffered readings keep it); the server records its own beside it
  sequenceNo: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();
export type DeviceReadingDto = z.infer<typeof DeviceReadingSchema>;

export const ColdExportTrailSchema = z.object({ subjectType: z.enum(COLD_CHAIN_SUBJECTS), subjectId: z.string().uuid(), days: z.coerce.number().int().min(1).max(730).default(90) }).strict();
export type ColdExportTrailParams = z.infer<typeof ColdExportTrailSchema>;
export const ColdExportBreachesSchema = z.object({ months: z.coerce.number().int().min(1).max(24).default(12) }).strict();
export type ColdExportBreachesParams = z.infer<typeof ColdExportBreachesSchema>;
