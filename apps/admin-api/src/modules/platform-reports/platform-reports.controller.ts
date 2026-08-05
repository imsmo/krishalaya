// apps/admin-api/src/modules/platform-reports/platform-reports.controller.ts · god-mode read-only exec dashboards
// (Law 11). Every route: AdminAuthGuard + OwnerPermissionsGuard with reports.read. PURE READS — no mutations, no
// hardware-key/step-up (nothing consequential happens); the @Global access interceptor logs each read. validate
// (zod) → authorize (owner perm) → delegate ONLY. Aggregates are cross-tenant (kv_admin) + window-bounded.
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/auth/admin-auth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodQuery } from '../../core/http/zod.pipe';
import { CustomReportSchema, CustomReportDto } from './dto/custom-report.dto';
import { CrossTenantAnalyticsService } from './services/cross-tenant-analytics.service';
import { GmvRollupsService } from './services/gmv-rollups.service';
import { CohortReportsService } from './services/cohort-reports.service';
import { RegulatorExportsService } from './services/regulator-exports.service';
import {
  QueryWindowSchema, QueryWindowDto, QueryGmvSchema, QueryGmvDto,
  QueryTenantGrowthSchema, QueryTenantGrowthDto, QueryRegulatorSchema, QueryRegulatorDto,
} from './dto/platform-reports.dto';

@Controller({ path: 'reports', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class PlatformReportsController {
  constructor(
    private readonly analytics: CrossTenantAnalyticsService,
    private readonly gmvRollups: GmvRollupsService,
    private readonly cohorts: CohortReportsService,
    private readonly regulator: RegulatorExportsService,
  ) {}

  @Get('overview') @RequireOwnerPermission(OwnerPermissions.ReportsRead)
  overview(@ZodQuery(QueryWindowSchema) q: QueryWindowDto) { return this.analytics.overview(q).then((data) => ({ data })); }

  @Get('gmv') @RequireOwnerPermission(OwnerPermissions.ReportsRead)
  gmv(@ZodQuery(QueryGmvSchema) q: QueryGmvDto) { return this.gmvRollups.gmv(q).then((data) => ({ data })); }

  @Get('tenant-growth') @RequireOwnerPermission(OwnerPermissions.ReportsRead)
  tenantGrowth(@ZodQuery(QueryTenantGrowthSchema) q: QueryTenantGrowthDto) { return this.cohorts.tenantGrowth(q).then((data) => ({ data })); }

  // PC-54 W54-11 slice 5: report builder v1 — whitelisted metric x window x bucket (never client SQL).
  @Get('custom') @RequireOwnerPermission(OwnerPermissions.ReportsRead)
  custom(@ZodQuery(CustomReportSchema) q: CustomReportDto) {
    return this.analytics.customSeries(q).then((data) => ({ data }));
  }

  @Get('regulator-export') @RequireOwnerPermission(OwnerPermissions.ReportsRead)
  regulatorExport(@ZodQuery(QueryRegulatorSchema) q: QueryRegulatorDto) { return this.regulator.export(q).then((data) => ({ data })); }
}
