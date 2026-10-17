// modules/catalogue/catalogue.module.ts
// Tenant-facing catalogue: browse global categories/attributes/products + manage the
// tenant's OWN categories (enable/disable), private products, and store batches. GLOBAL
// taxonomy WRITES (categories/attributes/platform products/brands/templates) live in
// apps/admin-api (Law 11) and are intentionally not exposed here.
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../core/jobs/scheduled-job.registry';
import { cadenceOf } from '../../core/jobs/clock-cadence';
import { BULK_APPLIER_REGISTRY, BulkApplierRegistry } from '../../core/bulk/bulk-applier.registry';
import { ProductBulkApplier } from './bulk/product-bulk-applier';
import { CategoriesController } from './controllers/v1/categories.controller';
import { AttributesController } from './controllers/v1/attributes.controller';
import { BrandsController } from './controllers/v1/brands.controller';
import { AttributeTemplatesController } from './controllers/v1/attribute-templates.controller';
import { ProductsController } from './controllers/v1/products.controller';
import { BatchesController } from './controllers/v1/batches.controller';
import { CertificatesController } from './controllers/v1/certificates.controller';
import { PublicCertificatesController } from './controllers/v1/public-certificates.controller';
import { CategoryService } from './services/category.service';
import { AttributeDefinitionService } from './services/attribute-definition.service';
import { AttributeOptionService } from './services/attribute-option.service';
import { AttributeTemplateService } from './services/attribute-template.service';
import { CategoryAttributeService } from './services/category-attribute.service';
import { BrandService } from './services/brand.service';
import { CertificateService } from './services/certificate.service';
import { PublicCertificateService } from './services/public-certificate.service';
import { CertificateExpiryClock } from './jobs/certificate-expiry-alerts.job';
import { RegulatedRuleService } from './services/regulated-rule.service';
import { ProductService } from './services/product.service';
import { ProductBatchService } from './services/product-batch.service';
import { ProductSearchReadModel } from './read-models/product-search.read-model';
import { CategoryRepository } from './repositories/category.repository';
import { AttributeDefinitionRepository } from './repositories/attribute-definition.repository';
import { AttributeOptionRepository } from './repositories/attribute-option.repository';
import { AttributeTemplateRepository } from './repositories/attribute-template.repository';
import { CategoryAttributeRepository } from './repositories/category-attribute.repository';
import { BrandRepository } from './repositories/brand.repository';
import { CertificateRepository } from './repositories/certificate.repository';
import { RegulatedRuleRepository } from './repositories/regulated-rule.repository';
import { ProductRepository } from './repositories/product.repository';
import { ProductBatchRepository } from './repositories/product-batch.repository';

@Module({
  // PC-56 STORE-5b: PublicCertificatesController BEFORE CertificatesController — `/v1/certificates/public` must never match the authed `:id`
  controllers: [CategoriesController, AttributesController, BrandsController, AttributeTemplatesController, PublicCertificatesController, CertificatesController, ProductsController, BatchesController],
  providers: [
    CategoryService, AttributeDefinitionService, AttributeOptionService, AttributeTemplateService, CategoryAttributeService, BrandService,
    CertificateService, PublicCertificateService, RegulatedRuleService, ProductService, ProductBatchService, ProductSearchReadModel,
    CategoryRepository, AttributeDefinitionRepository, AttributeOptionRepository, AttributeTemplateRepository, CategoryAttributeRepository, BrandRepository,
    CertificateRepository, RegulatedRuleRepository, ProductRepository, ProductBatchRepository,
    ProductBulkApplier,
    // PC-56 STORE-5b · D1 (survey C-5): the expiry clock, registered at the table's cadence (`certificate-expiry`, daily; flag-independent)
    { provide: CertificateExpiryClock, useFactory: (repo: CertificateRepository, certs: CertificateService) => new CertificateExpiryClock(cadenceOf('certificate-expiry'), repo, certs),
      inject: [CertificateRepository, CertificateService] },
  ],
  // public surface for other modules (Law 11): services only, never repositories
  exports: [CategoryService, AttributeDefinitionService, AttributeOptionService, AttributeTemplateService, CategoryAttributeService, BrandService, CertificateService, RegulatedRuleService, ProductService, ProductSearchReadModel],
})
export class CatalogueModule implements OnModuleInit {
  constructor(
    @Inject(BULK_APPLIER_REGISTRY) private readonly bulkRegistry: BulkApplierRegistry,
    private readonly productApplier: ProductBulkApplier,
    @Inject(SCHEDULED_JOB_REGISTRY) private readonly jobs: ScheduledJobRegistry,
    private readonly expiryClock: CertificateExpiryClock,
  ) {}
  // Plug the product CSV applier into the core bulk-import platform (import_type='products').
  onModuleInit(): void {
    this.bulkRegistry.register(this.productApplier);
    this.jobs.register(this.expiryClock);   // STORE-5b · D1: a lapsed verified certificate flips to expired — daily
  }
}
