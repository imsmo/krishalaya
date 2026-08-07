// apps/admin-api/src/modules/platform-reports/platform-reports.controller.ts · god-mode read-only exec dashboards
// (Law 11). Every route: AdminAuthGuard + OwnerPermissionsGuard with reports.read. PURE READS — no mutations, no
// hardware-key/step-up (nothing consequential happens); the @Global access interceptor logs each read. validate
// (zod) → authorize (owner perm) → delegate ONLY. Aggregates are cross-tenant (kv_admin) + window-bounded.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { CustomReportSchema, CustomReportDto } from './dto/custom-report.dto';
import { CrossTenantAnalyticsService } from './services/cross-tenant-analytics.service';
import { GmvRollupsService } from './services/gmv-rollups.service';
import { CohortReportsService } from './services/cohort-reports.service';
import { RegulatorExportsService } from './services/regulator-exports.service';
import { PlatformDashboardService } from './services/platform-dashboard.service';
import { ReportBuilderService } from './services/report-builder.service';
import {
  QueryWindowSchema, QueryWindowDto, QueryGmvSchema, QueryGmvDto,
  QueryTenantGrowthSchema, QueryTenantGrowthDto, QueryRegulatorSchema, QueryRegulatorDto,
  RunReportSchema, RunReportDto, SaveReportSchema, SaveReportDto,
  QueryReceiptsSchema, QueryReceiptsDto, QueryDashboardSchema, QueryDashboardDto,
} from './dto/platform-reports.dto';

const admin = (req: any): AdminRequestContext => req.admin;

@Controller({ path: 'reports', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class PlatformReportsController {
  constructor(
    private readonly analytics: CrossTenantAnalyticsService,
    private readonly gmvRollups: GmvRollupsService,
    private readonly cohorts: CohortReportsService,
    private readonly regulator: RegulatorExportsService,
    private readonly dashboard: PlatformDashboardService,
    private readonly builder: ReportBuilderService,
  ) {}

  /* ---------------- W001 · the platform dashboard, which had no numbers at all ---------------- */

  /**
   * `reports.read`, NOT `metrics.revenue.read` — deliberately.
   *
   * W001's restricted state describes a role that sees the dashboard and not the money ("Your role (Ops · L2) can't view
   * platform revenue"). Gating the whole screen on the revenue permission would make that state unreachable, so the
   * screen is `reports.read` and the payload's `revenue` block is stripped for a caller without the narrow grant —
   * a degraded page rather than a 403, which is what the canon asks for.
   */
  @Get('dashboard') @RequireOwnerPermission(OwnerPermissions.ReportsRead)
  platformDashboard(@Req() req: any, @ZodQuery(QueryDashboardSchema) q: QueryDashboardDto) {
    const a = admin(req);
    const maySeeRevenue = a.permissions.has('*') || a.permissions.has(OwnerPermissions.MetricsRevenueRead);
    return this.dashboard.dashboard(q.currency).then((data) => ({
      data: maySeeRevenue ? data : { ...data, revenue: null },
      meta: {
        revenueVisible: maySeeRevenue,
        // Named so the console can tell the operator WHICH grant to ask for, which is what W001's restricted copy does.
        revenueGate: OwnerPermissions.MetricsRevenueRead,
      },
    }));
  }

  @Get('dashboard/alerts') @RequireOwnerPermission(OwnerPermissions.ReportsRead)
  dashboardAlerts() { return this.dashboard.alerts().then((data) => ({ data })); }

  /* ---------------- W111 · the builder ---------------- */

  @Get('builder/vocabulary') @RequireOwnerPermission(OwnerPermissions.AnalyticsRead)
  vocabulary() { return this.builder.vocabulary().then((data) => ({ data })); }

  /** A RUN IS A POST, and W111 models it as one too (`Run report` is a chain-mutate). It writes no business row, and it
   *  is a bounded, timed-out, audited scan of production tables — that is a deliberate act, not a navigation. */
  @Post('builder/run') @RequireOwnerPermission(OwnerPermissions.AnalyticsRead)
  runReport(@Req() req: any, @ZodBody(RunReportSchema) body: RunReportDto) {
    return this.builder.run(admin(req), body).then((data) => ({ data }));
  }

  /** **THE EXPORT IS ITS OWN PERMISSION.** Reading a figure and walking out with the file are different acts — W111 says
   *  so: "Needs analytics.read; exports need analytics.export." */
  @Post('builder/export') @RequireOwnerPermission(OwnerPermissions.AnalyticsExport)
  exportReport(@Req() req: any, @ZodBody(RunReportSchema) body: RunReportDto) {
    return this.builder.exportSeries(admin(req), body).then((data) => ({ data }));
  }

  @Get('builder/saved') @RequireOwnerPermission(OwnerPermissions.AnalyticsRead)
  savedReports() { return this.builder.listSaved(); }

  @Post('builder/saved') @RequireOwnerPermission(OwnerPermissions.AnalyticsRead)
  saveReport(@Req() req: any, @ZodBody(SaveReportSchema) body: SaveReportDto) {
    return this.builder.save(admin(req), body).then((data) => ({ data }));
  }

  @Post('builder/saved/:slug/run') @RequireOwnerPermission(OwnerPermissions.AnalyticsRead)
  runSaved(@Req() req: any, @Param('slug') slug: string) {
    return this.builder.runSaved(admin(req), slug).then((data) => ({ data }));
  }

  @Post('builder/saved/:slug/archive') @RequireOwnerPermission(OwnerPermissions.AnalyticsRead)
  archiveSaved(@Req() req: any, @Param('slug') slug: string) {
    return this.builder.archive(admin(req), slug).then((data) => ({ data }));
  }

  /* ---------------- the receipts, and the fetch log W2127 promises ---------------- */

  @Get('exports/receipts') @RequireOwnerPermission(OwnerPermissions.AnalyticsRead)
  receipts(@ZodQuery(QueryReceiptsSchema) q: QueryReceiptsDto) { return this.builder.receipts(q); }

  @Get('exports/receipts/:id') @RequireOwnerPermission(OwnerPermissions.AnalyticsRead)
  receipt(@Param('id') id: string) { return this.builder.receipt(id).then((data) => ({ data })); }

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
