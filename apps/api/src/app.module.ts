// apps/api/src/app.module.ts · ROOT WIRING
// Order matters: core plumbing first, then business modules. A module not
// imported here does not exist at runtime — this file IS the tree's trunk.
// Phase 1 wires the listings vertical slice end-to-end; the remaining PRD
// modules are added here one by one as they are implemented (copy listings).
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { RequestIdMiddleware } from './core/http/request-id.middleware';
import { SecurityHeadersMiddleware } from './core/http/security-headers.middleware';
import { HttpLogMiddleware } from './core/http/http-log.middleware';
import { TenantContextMiddleware } from './core/tenancy-context/tenant-context.middleware';
import { ListingsModule } from './modules/listings/listings.module';
import { OrdersModule } from './modules/orders/orders.module';
import { BuyerModule } from './modules/buyer/buyer.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { MediaModule } from './core/media/media.module';
import { BulkModule } from './core/bulk/bulk.module';
import { AuctionsModule } from './modules/auctions/auctions.module';
import { OffersModule } from './modules/offers/offers.module';
import { RequirementsModule } from './modules/requirements/requirements.module';
import { LogisticsModule } from './modules/logistics/logistics.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { DisputesModule } from './modules/disputes/disputes.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { LabourModule } from './modules/labour/labour.module';
import { LivestockModule } from './modules/livestock/livestock.module';
import { DairyModule } from './modules/dairy/dairy.module';
import { GroupLotsModule } from './modules/group-lots/group-lots.module';
import { AuditTrailModule } from './modules/audit/audit.module';
import { AssistantModule } from './modules/assistant/assistant.module';
import { UnifiedSearchModule } from './modules/search/search.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { WarehousingModule } from './modules/warehousing/warehousing.module';
import { ContractFarmingModule } from './modules/contract-farming/contract-farming.module';
import { ExportsModule } from './modules/exports/exports.module';
import { LandSoilWeatherModule } from './modules/land-soil-weather/land-soil-weather.module';
import { FintechModule } from './modules/fintech/fintech.module';
import { InsuranceModule } from './modules/insurance/insurance.module';
import { SchemesModule } from './modules/schemes/schemes.module';
import { ServicesMarketplaceModule } from './modules/services-marketplace/services-marketplace.module';
import { CommunicationModule } from './modules/communication/communication.module';
import { EducationModule } from './modules/education/education.module';
import { AmbassadorsModule } from './modules/ambassadors/ambassadors.module';
import { SupportModule } from './modules/support/support.module';
import { CmsModule } from './modules/cms/cms.module';
import { MarketIntelModule } from './modules/market-intel/market-intel.module';
import { TraceabilityModule } from './modules/traceability/traceability.module';
import { AiGovernanceModule } from './modules/ai-governance/ai-governance.module';
import { IdentityModule } from './modules/identity/identity.module';
import { CatalogueModule } from './modules/catalogue/catalogue.module';
import { LookupsModule } from './modules/lookups/lookups.module';
import { TenantIntegrationsModule } from './modules/tenant-integrations/tenant-integrations.module';
import { PartnerApiModule } from './modules/partner-api/partner-api.module';
import { TenantWebhooksModule } from './modules/tenant-webhooks/tenant-webhooks.module';

@Module({
  imports: [CoreModule, IdentityModule, CatalogueModule, LookupsModule, ListingsModule, OrdersModule, BuyerModule, PaymentsModule, MediaModule, BulkModule, AuctionsModule, OffersModule, RequirementsModule, LogisticsModule, ReviewsModule, DisputesModule, PromotionsModule, MembershipsModule, TenancyModule, TenantIntegrationsModule, TenantWebhooksModule, PartnerApiModule, LabourModule, LivestockModule, DairyModule, GroupLotsModule, EquipmentModule, WarehousingModule, ContractFarmingModule, ExportsModule, LandSoilWeatherModule, FintechModule, InsuranceModule, SchemesModule, ServicesMarketplaceModule, CommunicationModule, EducationModule, AmbassadorsModule, SupportModule, CmsModule, MarketIntelModule, TraceabilityModule, AiGovernanceModule, AuditTrailModule, AssistantModule, UnifiedSearchModule],
})
export class AppModule implements NestModule {
  // security-headers (every response, incl. error paths) THEN request-id THEN tenant-context (Law 1) on every route.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SecurityHeadersMiddleware, RequestIdMiddleware, HttpLogMiddleware, TenantContextMiddleware).forRoutes('*');
  }
}
