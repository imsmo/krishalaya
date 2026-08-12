// modules/listings/listings.module.ts
// Wires the listings bounded context into apps/api. Boundary rule (Law 11): other
// modules depend on the SERVICES exported here, never on repositories or the DB.
// Core infra (UnitOfWork, OutboxWriter, ReadReplica, Quota, Idempotency, Cache,
// Search, Metrics) is provided by CoreModule (global) and injected by token.
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { MediaModule } from '../../core/media/media.module';
import { IdentityModule } from '../identity/identity.module';   // TENANT-2b: ConsentService for the on-behalf gate (Law 11 reuse — the ambassadors precedent)   // OBJECT_STORE for public listing-gallery presign
import { CommunicationModule } from '../communication/communication.module'; // ConversationService for :id/inquiries (KV-BL-031)

// Controllers (HTTP edge)
import { ListingsController } from './controllers/listings.controller';
import { ListingQcController } from './controllers/listing-qc.controller';
import { BoostsController } from './controllers/boosts.controller';
import { GroupLotsController } from './controllers/group-lots.controller';
import { SellersController } from './controllers/sellers.controller';
import { TrustDocumentsController } from './controllers/trust-documents.controller';

// Application services
import { ListingService } from './services/listing.service';
import { ListingBoostService } from './services/listing-boost.service';
import { ListingViewService } from './services/listing-view.service';
import { ListingInquiryService } from './services/listing-inquiry.service';
import { ListingTrustDocumentService } from './services/listing-trust-document.service';
import { ListingAttributeService } from './services/listing-attribute.service';
import { GroupLotService } from './services/group-lot.service';
import { GroupLotPledgeService } from './services/group-lot-pledge.service';
import { OnBehalfConsoleService } from './services/on-behalf-console.service';
import { ListingBulkApplier } from './bulk/listing-bulk-applier';
import { BULK_APPLIER_REGISTRY, BulkApplierRegistry } from '../../core/bulk/bulk-applier.registry';

// Read-models (CQRS read path)
import { ListingSearchReadModel } from './read-models/listing-search.read-model';
import { MandiBandReadModel } from './read-models/mandi-band.read-model';
import { ListingConsoleReadModel } from './read-models/listing-console.read-model';
import { ListingAnalyticsReadModel } from './read-models/listing-analytics.read-model';
import { SellerProfileReadModel } from './read-models/seller-profile.read-model';
import { ListingGalleryReadModel } from './read-models/listing-gallery.read-model';
import { ListingLinksReadModel } from './read-models/listing-links.read-model';

// Repositories (write/read SQL)
import { ListingRepository } from './repositories/listing.repository';
import { PriceHistoryRepository } from './repositories/price-history.repository';
import { ListingAttributeRepository } from './repositories/listing-attribute.repository';
import { ListingBoostRepository } from './repositories/listing-boost.repository';
import { GroupLotRepository } from './repositories/group-lot.repository';
import { GroupLotPledgeRepository } from './repositories/group-lot-pledge.repository';
import { ListingMediaRepository } from './repositories/listing-media.repository';
import { ListingTrustDocumentRepository } from './repositories/listing-trust-document.repository';

// Event handlers (consume domain/integration events)
import { OrderCompletedHandler } from './events/handlers/order-completed.handler';
import { AuctionSettledHandler } from './events/handlers/auction-settled.handler';

// Scheduled jobs (run in worker; registered here so DI resolves their deps)
import { ExpireListingsJob } from './jobs/expire-listings.job';
import { BoostExpiryJob } from './jobs/boost-expiry.job';
import { PublishScheduledJob } from './jobs/publish-scheduled.job';

@Module({
  imports: [MediaModule, CommunicationModule, IdentityModule],
  controllers: [ListingsController, ListingQcController, BoostsController, GroupLotsController, SellersController, TrustDocumentsController],
  providers: [
    ListingService, ListingBoostService, ListingViewService, ListingInquiryService, ListingTrustDocumentService,
    ListingAttributeService, GroupLotService, GroupLotPledgeService, OnBehalfConsoleService, ListingBulkApplier,
    ListingSearchReadModel, MandiBandReadModel, ListingConsoleReadModel, ListingAnalyticsReadModel, SellerProfileReadModel, ListingGalleryReadModel, ListingLinksReadModel,
    ListingRepository, PriceHistoryRepository, ListingAttributeRepository,
    ListingBoostRepository, GroupLotRepository, GroupLotPledgeRepository, ListingMediaRepository, ListingTrustDocumentRepository,
    OrderCompletedHandler, AuctionSettledHandler,
    ExpireListingsJob, BoostExpiryJob, PublishScheduledJob,
  ],
  // Export only what other bounded contexts may call (services + read-models).
  exports: [ListingService, GroupLotService, ListingSearchReadModel, MandiBandReadModel,
            ExpireListingsJob, BoostExpiryJob, PublishScheduledJob,
            OrderCompletedHandler, AuctionSettledHandler],
})
export class ListingsModule implements OnModuleInit {
  constructor(
    @Inject(BULK_APPLIER_REGISTRY) private readonly bulkRegistry: BulkApplierRegistry,
    private readonly listingApplier: ListingBulkApplier,
  ) {}
  onModuleInit(): void {
    // PC-56 TENANT-2c: the 'listings' importer W128 needs. Registered in the module that OWNS listings — core/bulk
    // stays generic plumbing and never learns what a lot is (the contract 'products' and 'members' already follow).
    // Before this line, `importType: 'listings'` was a 422 and W128's whole screen pointed at nothing.
    this.bulkRegistry.register(this.listingApplier);
  }
}
