// apps/admin-api/src/modules/platform-reports/platform-reports.module.ts · the god-mode read-only EXEC DASHBOARDS
// plane (Law 11). Cross-tenant aggregates over existing data (subscriptions/orders/tenants/login_events) — MRR/ARR,
// GMV, active tenants, active users, tenant growth, and a PII-free regulator export. Pure reads (no writes, no
// money movement); admin-api's kv_admin bypasses RLS for the platform rollup. Mounts under AdminCoreModule.
import { Module } from '@nestjs/common';
import { PlatformReportsController } from './platform-reports.controller';
import { PlatformReportsReadModel } from './read-models/platform-reports.read-model';
import { CrossTenantAnalyticsService } from './services/cross-tenant-analytics.service';
import { GmvRollupsService } from './services/gmv-rollups.service';
import { CohortReportsService } from './services/cohort-reports.service';
import { RegulatorExportsService } from './services/regulator-exports.service';
// PC-56 ADMIN-10: the dashboard W001 promised and never had, and the builder + receipted export W111 describes.
import { PlatformDashboardService } from './services/platform-dashboard.service';
import { ReportBuilderService } from './services/report-builder.service';
import { ReportsPlaneRepository } from './repositories/reports-plane.repository';

@Module({
  controllers: [PlatformReportsController],
  providers: [
    PlatformReportsReadModel, CrossTenantAnalyticsService, GmvRollupsService, CohortReportsService,
    RegulatorExportsService,
    // PC-56 ADMIN-10. Registered here as well as imported — the lint caught these three imported and unregistered,
    // which compiles cleanly and fails at the first request with a Nest DI error. Worth the note: an unused-import rule
    // is usually a tidiness check and here it was the only thing standing between this wave and a broken dashboard.
    PlatformDashboardService, ReportBuilderService, ReportsPlaneRepository,
  ],
})
export class PlatformReportsModule {}
