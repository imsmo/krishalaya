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
// PC-56 ADMIN-9: the first registry of the platform's OWN operators. Until 0118 the god-mode realm authorised every
// request from a token alone and had no list of the people it let in, no way to deactivate one, and no way to end a
// session.
import { PlatformStaffModule } from './modules/platform-staff/platform-staff.module';
// PC-56 ADMIN-11: the typed platform settings registry — `scope='platform'` rows were unreachable by every surface.
import { MarketOpsModule } from './modules/market-ops/market-ops.module';
import { PlatformApiOpsModule } from './modules/platform-api-ops/platform-api-ops.module';
import { TemplatesOpsModule } from './modules/templates-ops/templates-ops.module';
import { SettingsOpsModule } from './modules/settings-ops/settings-ops.module';
import { GlobalCatalogueOpsModule } from './modules/global-catalogue-ops/global-catalogue-ops.module';
import { SchemesRegistryOpsModule } from './modules/schemes-registry-ops/schemes-registry-ops.module';
import { SchemesOversightModule } from './modules/schemes-oversight/schemes-oversight.module';
import { ConsentOpsModule } from './modules/consent-ops/consent-ops.module';
import { TenantApplicationsOpsModule } from './modules/tenant-applications-ops/tenant-applications-ops.module';
import { TrustSafetyModule } from './modules/trust-safety/trust-safety.module';
import { LedgerCorrectionModule } from './modules/ledger-correction/ledger-correction.module';
import { ModerationQueueModule } from './modules/moderation-queue/moderation-queue.module';
import { AppealsModule } from './modules/appeals/appeals.module';
import { CommHubModule } from './modules/comm-hub/comm-hub.module';
import { SafetyDeskModule } from './modules/safety-desk/safety-desk.module';
import { LedgerOpsModule } from './modules/ledger-ops/ledger-ops.module';
import { PayoutOpsModule } from './modules/payout-ops/payout-ops.module';
import { TranslationsModule } from './modules/translations/translations.module';
import { CatalogueDepthModule } from './modules/catalogue-depth/catalogue-depth.module';
import { CellsOpsModule } from './modules/cells-ops/cells-ops.module';

@Module({
  imports: [AdminCoreModule, AiModelsOpsModule, TenantOpsModule, ReconMonitorModule, ComplianceOpsModule, BillingOpsModule, FlagsOpsModule, PlansOpsModule, ImpersonationModule, SupportOversightModule, PlatformReportsModule, ProvidersOpsModule, AnnouncementsModule, GlobalCatalogueOpsModule, SchemesRegistryOpsModule, SchemesOversightModule, ConsentOpsModule, CellsOpsModule, CatalogueDepthModule,
    // PC-56 ADMIN-3b: the translations plane — the first write path this table has ever had
    TranslationsModule, TenantApplicationsOpsModule, PlatformStaffModule, SettingsOpsModule, TemplatesOpsModule, PlatformApiOpsModule, MarketOpsModule,
  // PC-56 ADMIN-5d: the trust & safety plane — the first code ever to reach `platform_blocklists` / `risk_rules` /
  // `appeals`, which 0067 created for an admin realm that had no grant on them.
  TrustSafetyModule,
  // PC-56 ADMIN-5e: W068 — the only path by which a person's wallet balance changes by hand.
  LedgerCorrectionModule,
  // PC-56 ADMIN-5f: the moderation queue — the first code that makes "removed" actually remove a listing.
  ModerationQueueModule,
  // PC-56 ADMIN-SWEEP-b1: appeals — the first WRITERS `appeals` (0067) has ever had, and the desk that sits in
  // judgement on the two modules above. Until this module, the overturn rate on the trust overview was 0/0 forever.
  AppealsModule,
  // PC-56 ADMIN-SWEEP-b2: the communication hub — one thread per principal, joined on users.id (0133's
  // channel-identity decision), claimed pull-first because no routing engine exists and the screen says so.
  CommHubModule,
  // PC-56 ADMIN-SWEEP-b3: the emergency & safety desk — records human acts in 0098's honest vocabulary; no paging
  // provider exists and no step ever claims one fired.
  SafetyDeskModule,
  // PC-56 ADMIN-6: the ledger explorer and the first code on this platform that reads `prev_hash`.
  LedgerOpsModule],
})
export class AdminModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(IpAllowlistMiddleware).forRoutes('*');   // IP-restrict the entire god-mode plane
  }
}
