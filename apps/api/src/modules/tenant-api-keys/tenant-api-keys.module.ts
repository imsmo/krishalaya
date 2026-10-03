// modules/tenant-api-keys/tenant-api-keys.module.ts · PC-56 TENANT-13c (F-9) · TENANT API KEYS — a credential realm.
// A tenant_admin (`api.manage`, `api_access` plan feature, `tenant_api` flag) issues a scoped key shown once and stored as sha256; the
// key authenticates on the catalogue's routes only, with the tenant taken FROM THE KEY (never a header), exact-match scopes, a per-key
// hourly quota, Idempotency-Key on writes, and every act recorded as `api_key:<id>` on behalf of its creator. Member-PII scopes need a
// second administrator (proposal + DB trigger). @Global so core's tenant-context middleware can inject the authenticator port.
import { Global, Inject, Module, OnModuleInit } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { API_KEY_AUTHENTICATOR } from '../../core/auth/api-key.port';
import { UNIT_OF_WORK, UnitOfWork } from '../../core/database/unit-of-work';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../core/jobs/scheduled-job.registry';
import { ApiKeysController } from './controllers/v1/api-keys.controller';
import { ApiKeyRepository } from './repositories/api-key.repository';
import { ApiKeyService } from './services/api-key.service';
import { ApiKeyAuthenticatorService } from './services/api-key-authenticator.service';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { ApiKeyIdempotencyInterceptor } from './guards/api-key-idempotency.interceptor';
import { ApiKeyProposalsExpiryJob } from './jobs/api-key-proposals-expiry.job';

@Global()
@Module({
  controllers: [ApiKeysController],
  providers: [
    ApiKeyRepository, ApiKeyService, ApiKeyAuthenticatorService,
    { provide: API_KEY_AUTHENTICATOR, useExisting: ApiKeyAuthenticatorService },
    // GLOBAL: every route refuses a key unless it carries @ApiScopes and the key holds that scope exactly.
    { provide: APP_GUARD, useClass: ApiKeyAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ApiKeyIdempotencyInterceptor },
    { provide: ApiKeyProposalsExpiryJob, inject: [UNIT_OF_WORK, ApiKeyRepository, ApiKeyService],
      useFactory: (u: UnitOfWork, r: ApiKeyRepository, s: ApiKeyService) => new ApiKeyProposalsExpiryJob(60 * 60_000, u, r, s) },
  ],
  exports: [API_KEY_AUTHENTICATOR, ApiKeyService],
})
export class TenantApiKeysModule implements OnModuleInit {
  constructor(@Inject(SCHEDULED_JOB_REGISTRY) private readonly jobs: ScheduledJobRegistry, private readonly expiry: ApiKeyProposalsExpiryJob) {}
  onModuleInit(): void { this.jobs.register(this.expiry); }
}
