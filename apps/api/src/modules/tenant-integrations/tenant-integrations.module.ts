// modules/tenant-integrations/tenant-integrations.module.ts · tenant self-serve provider connections — PC-56 TENANT-13c (F-8).
// A tenant_admin proposes connecting its OWN credential for an ownable provider (razorpay, gupshup, inaph — the platform allow-list in
// integration_providers.tenant_ownable); the credential is VERIFIED against the provider before anything is stored, held sealed on the
// proposal, and vaulted only after a DIFFERENT tenant_admin confirms and it verifies again. A daily job re-verifies every connection
// (the Health source). No platform path reads a tenant connection today — the console says so. The SecretWriter / SecretReader binding
// fails CLOSED in production (AWS or boot crashes); the verifier is the pinned, redirect-refusing transport. Gated by `tenancy`.
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { AppConfig } from '../../core/config/app-config';
import { RESILIENCE, ResilienceService } from '../../core/resilience/resilience.service';
import { UNIT_OF_WORK, UnitOfWork } from '../../core/database/unit-of-work';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../core/jobs/scheduled-job.registry';
import { SECRET_WRITER } from '../../core/secrets/secret-writer.port';
import { SECRET_READER } from '../../core/secrets/secret-reader.port';
import { LocalSecretWriter } from '../../core/secrets/local-secret-writer';
import { AwsSecretWriter } from '../../core/secrets/aws-secret-writer';
import { IntegrationsController } from './controllers/v1/integrations.controller';
import { TenantIntegrationService } from './services/tenant-integration.service';
import { TenantIntegrationRepository } from './repositories/tenant-integration.repository';
import { HttpProviderVerifier, PROVIDER_VERIFIER } from './infra/provider-verifier';
import { IntegrationReverifyJob } from './jobs/integration-reverify.job';
import { IntegrationProposalsClockJob } from './jobs/integration-proposals-clock.job';

const VAULT = Symbol('TENANT_CREDENTIAL_VAULT');

@Module({
  controllers: [IntegrationsController],
  providers: [
    TenantIntegrationService,
    TenantIntegrationRepository,
    {
      // ONE vault object serves both ports, so the local dev store reads back what it wrote
      provide: VAULT,
      inject: [AppConfig, RESILIENCE],
      useFactory: (config: AppConfig, resilience: ResilienceService) => {
        const { backend, region, prefix } = config.integrationSecrets;
        if (backend === 'aws') return new AwsSecretWriter({ region, prefix }, resilience);
        // Fail CLOSED: the dev in-process vault must NEVER run in production.
        if (config.isProd) {
          throw new Error('INTEGRATION_SECRETS_BACKEND must be "aws" in production — refusing to use the local in-process vault for tenant credentials');
        }
        return new LocalSecretWriter();
      },
    },
    { provide: SECRET_WRITER, useExisting: VAULT },
    { provide: SECRET_READER, useExisting: VAULT },
    { provide: PROVIDER_VERIFIER, inject: [RESILIENCE], useFactory: (resilience: ResilienceService) => new HttpProviderVerifier(resilience) },
    { provide: IntegrationReverifyJob, inject: [UNIT_OF_WORK, TenantIntegrationRepository, TenantIntegrationService],
      useFactory: (u: UnitOfWork, r: TenantIntegrationRepository, s: TenantIntegrationService) => new IntegrationReverifyJob(60 * 60_000, u, r, s) },
    { provide: IntegrationProposalsClockJob, inject: [UNIT_OF_WORK, TenantIntegrationRepository, TenantIntegrationService],
      useFactory: (u: UnitOfWork, r: TenantIntegrationRepository, s: TenantIntegrationService) => new IntegrationProposalsClockJob(10 * 60_000, u, r, s) },
  ],
  exports: [TenantIntegrationService],
})
export class TenantIntegrationsModule implements OnModuleInit {
  constructor(
    @Inject(SCHEDULED_JOB_REGISTRY) private readonly jobs: ScheduledJobRegistry,
    private readonly reverify: IntegrationReverifyJob,
    private readonly clock: IntegrationProposalsClockJob,
  ) {}
  onModuleInit(): void { this.jobs.register(this.reverify); this.jobs.register(this.clock); }
}
