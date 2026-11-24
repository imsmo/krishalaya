// apps/admin-api/src/modules/plans-ops/dto/plans-ops.dto.ts · zod .strict() request schemas (reject unknown keys
// → no mass-assignment). Every consequential mutation carries a reason (audit/§4). MONEY is accepted ONLY as a
// string of digits (minor units) and parsed to bigint in the service — never a JS number/float (Law 2). Limit
// values accept '-1' (unlimited) or a non-negative integer string. Identifiers are charset-bounded (ReDoS-safe).
import { z } from 'zod';
import { PLAN_STATUSES } from '../domain/plan.state';

const Reason = z.string().min(3).max(1000);
const Cursor = z.string().max(200).optional();
const Limit = z.coerce.number().int().min(1).max(100).prefault(50);
const MinorUnits = z.string().regex(/^[0-9]{1,15}$/, 'amount must be a non-negative integer in minor units');
const LimitValue = z.string().regex(/^(-1|[0-9]{1,18})$/, "limit must be '-1' (unlimited) or a non-negative integer");
const PlanCode = z.string().regex(/^[a-z0-9_]{2,40}$/);
const Country = z.string().regex(/^[A-Z]{2}$/);
const Currency = z.string().regex(/^[A-Z]{3}$/);
const FeatureConfig = z.record(z.string(), z.unknown()).refine((o) => JSON.stringify(o).length <= 4000, 'config too large').optional();

export const QueryPlansSchema = z.object({
  code: PlanCode.optional(),
  country: Country.optional(),
  status: z.enum(PLAN_STATUSES).optional(),
  publicOnly: z.enum(['true', 'false']).optional(),
  cursor: Cursor,
  limit: Limit,
}).strict();
export type QueryPlansDto = z.infer<typeof QueryPlansSchema>;

export const QueryPlanHistorySchema = z.object({ cursor: Cursor, limit: Limit }).strict();
export type QueryPlanHistoryDto = z.infer<typeof QueryPlanHistorySchema>;

export const CreatePlanSchema = z.object({
  code: PlanCode,
  defaultName: z.string().min(1).max(100),
  countryCode: Country,
  currencyCode: Currency,
  monthlyPriceMinor: MinorUnits,
  annualPriceMinor: MinorUnits,
  setupFeeMinor: MinorUnits.prefault('0'),
  isPublic: z.boolean().prefault(true),
  reason: Reason,
}).strict();
export type CreatePlanDto = z.infer<typeof CreatePlanSchema>;

export const UpdatePlanLifecycleSchema = z.object({
  action: z.enum(['publish', 'archive', 'reactivate']),
  reason: Reason,
}).strict();
export type UpdatePlanLifecycleDto = z.infer<typeof UpdatePlanLifecycleSchema>;

export const SetPricingSchema = z.object({
  monthlyPriceMinor: MinorUnits,
  annualPriceMinor: MinorUnits,
  setupFeeMinor: MinorUnits.prefault('0'),
  reason: Reason,
}).strict();
export type SetPricingDto = z.infer<typeof SetPricingSchema>;

export const VersionPlanSchema = z.object({
  monthlyPriceMinor: MinorUnits,
  annualPriceMinor: MinorUnits,
  setupFeeMinor: MinorUnits.prefault('0'),
  isPublic: z.boolean().optional(),     // a private/custom (anchor) version stays unlisted
  reason: Reason,
}).strict();
export type VersionPlanDto = z.infer<typeof VersionPlanSchema>;

export const SetFeatureSchema = z.object({
  isIncluded: z.boolean().prefault(true),
  config: FeatureConfig,
  reason: Reason,
}).strict();
export type SetFeatureDto = z.infer<typeof SetFeatureSchema>;

export const SetLimitSchema = z.object({
  limitValue: LimitValue,
  reason: Reason,
}).strict();
export type SetLimitDto = z.infer<typeof SetLimitSchema>;
