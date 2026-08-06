// apps/admin-api/src/admin.module.ts · the god-mode plane root module (Law 11 — separate security realm from
// apps/api). Pulls in the @Global AdminCoreModule (config / kv_admin pool / admin-JWT auth / owner RBAC + FIDO2
// & step-up guards / in-tx audit + access interceptor), applies the IP-allowlist middleware to every route
// (defence in depth, before auth), and mounts the platform-ops modules. This session wires ai-models-ops; the
// other ops modules are scaffolded and mount here the same way as they're built.
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AdminCoreModule } from './core/admin-core.module';
import { IpAllowlistMiddleware } from './core/auth/ip-allowlist.middleware';
import { AiModelsOpsModule } from './modules/ai-models-ops/ai-models-ops.module';
import { TenantOpsModule } from './modules/tenant-ops/tenant-ops.module';
import { ReconMonitorModule } from './modules/recon-monitor/recon-monitor.module';
import { ComplianceOpsModule } from './modules/compliance-ops/compliance-ops.module';
import { BillingOpsModule } from './modules/billing-ops/billing-ops.module';
import { FlagsOpsModule } from './modules/flags-ops/flags-ops.module';
import { PlansOpsModule } from './modules/plans-ops/plans-ops.module';
import { ImpersonationModule } from './modules/impersonation/impersonation.module';
import { SupportOversightModule } from './modules/support-oversight/support-oversight.module';
import { PlatformReportsModule } from './modules/platform-reports/platform-reports.module';
import { ProvidersOpsModule } from './modules/providers-ops/providers-ops.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { GlobalCatalogueOpsModule } from './modules/global-catalogue-ops/global-catalogue-ops.module';
import { SchemesRegistryOpsModule } from './modules/schemes-registry-ops/schemes-registry-ops.module';
import { SchemesOversightModule } from './modules/schemes-oversight/schemes-oversight.module';
import { TenantApplicationsOpsModule } from './modules/tenant-applications-ops/tenant-applications-ops.module';
import { TranslationsModule } from './modules/translations/translations.module';
import { CatalogueDepthModule } from './modules/catalogue-depth/catalogue-depth.module';
import { CellsOpsModule } from './modules/cells-ops/cells-ops.module';

@Module({
  imports: [AdminCoreModule, AiModelsOpsModule, TenantOpsModule, ReconMonitorModule, ComplianceOpsModule, BillingOpsModule, FlagsOpsModule, PlansOpsModule, ImpersonationModule, SupportOversightModule, PlatformReportsModule, ProvidersOpsModule, AnnouncementsModule, GlobalCatalogueOpsModule, SchemesRegistryOpsModule, SchemesOversightModule, CellsOpsModule, CatalogueDepthModule,
    // PC-56 ADMIN-3b: the translations plane — the first write path this table has ever had
    TranslationsModule, TenantApplicationsOpsModule],
})
export class AdminModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(IpAllowlistMiddleware).forRoutes('*');   // IP-restrict the entire god-mode plane
  }
}
