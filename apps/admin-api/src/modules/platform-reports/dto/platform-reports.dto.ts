// apps/admin-api/src/modules/platform-reports/dto/platform-reports.dto.ts · zod .strict() query schemas for the
// read-only exec dashboards (reject unknown keys). Windows are optional ISO timestamps (validated + bounded in the
// domain via resolveWindow); currency is ISO-4217. No mutations here — pure reads.
import { z } from 'zod';

const Iso = z.string().datetime().optional();
const Currency = z.string().regex(/^[A-Z]{3}$/).default('INR');

export const QueryWindowSchema = z.object({ from: Iso, to: Iso, currency: Currency }).strict();
export type QueryWindowDto = z.infer<typeof QueryWindowSchema>;

export const QueryGmvSchema = z.object({ from: Iso, to: Iso, tenantId: z.string().uuid().optional(), currency: Currency }).strict();
export type QueryGmvDto = z.infer<typeof QueryGmvSchema>;

export const QueryTenantGrowthSchema = z.object({ from: Iso, to: Iso }).strict();
export type QueryTenantGrowthDto = z.infer<typeof QueryTenantGrowthSchema>;

export const QueryRegulatorSchema = z.object({ from: Iso, to: Iso, currency: Currency }).strict();
export type QueryRegulatorDto = z.infer<typeof QueryRegulatorSchema>;

/* ------------------------------------------------------------------------------------------------ */
/* PC-56 ADMIN-10                                                                                    */
/* ------------------------------------------------------------------------------------------------ */

/** The builder's run/export shape. `from` and `to` are REQUIRED here, unlike the dashboard's optional window: an ad-hoc
 *  query with an implied range is a query whose cost the operator did not choose. */
export const RunReportSchema = z.object({
  metric: z.enum(['orders', 'gmv_minor', 'new_tenants', 'new_users', 'dbt_minor']),
  from: z.string().datetime(),
  to: z.string().datetime(),
  bucket: z.enum(['day', 'week', 'month']).default('day'),
}).strict();
export type RunReportDto = z.infer<typeof RunReportSchema>;

export const SaveReportSchema = z.object({
  slug: z.string().trim().regex(/^[a-z][a-z0-9-]{1,59}$/),
  title: z.string().trim().min(3).max(160),
  metric: z.enum(['orders', 'gmv_minor', 'new_tenants', 'new_users', 'dbt_minor']),
  bucket: z.enum(['day', 'week', 'month']).default('day'),
  // RELATIVE, never two dates — a saved definition pinned to absolute dates is wrong the day after it is saved, and
  // nobody notices because it keeps producing a file.
  windowDays: z.number().int().min(1).max(366).default(30),
  currency: z.string().length(3).default('INR'),
  filters: z.record(z.unknown()).optional(),
  isShared: z.boolean().default(false),
  notes: z.string().trim().max(2_000).optional(),
}).strict();
export type SaveReportDto = z.infer<typeof SaveReportSchema>;

export const QueryReceiptsSchema = z.object({
  report: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
export type QueryReceiptsDto = z.infer<typeof QueryReceiptsSchema>;

export const QueryDashboardSchema = z.object({
  currency: z.string().length(3).default('INR'),
}).strict();
export type QueryDashboardDto = z.infer<typeof QueryDashboardSchema>;
