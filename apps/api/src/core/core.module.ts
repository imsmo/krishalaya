// core/core.module.ts
// THE platform plumbing module. Global, imported once by AppModule. It binds
// every abstract infrastructure contract to its concrete implementation so that
// business modules depend only on tokens (UNIT_OF_WORK, OUTBOX_WRITER, …) and
// never on `pg`, Redis, etc. Swapping an implementation (e.g. OpenSearch search,
// Kafka outbox) is a one-line change here — no module rewrites.
import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import Redis from 'ioredis';

import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { CacheModule } from './cache/cache.module';
import { SearchModule } from './search/search.module';
import { AuditModule } from './audit/audit.module';
import { FeatureFlagsModule } from './feature-flags/flags.module';
import { I18nModule } from './i18n/i18n.module';
import { RateLimitGuard } from './http/rate-limit.guard';

import { TokenService, TOKEN_SERVICE } from './auth/token.service';
import { OtpService, OTP_SERVICE, SMS_SENDER } from './auth/otp.service';
import { RefreshTokenService } from './auth/refresh-token.service';
import { smsSenderProvider } from './auth/sms-sender.provider';
import { RoleCacheService, ROLE_CACHE_SERVICE } from './rbac/role-cache.service';

import { OUTBOX_WRITER } from './outbox/outbox.writer';
import { PgOutboxWriter } from './outbox/outbox.writer.pg';
import { OutboxHandlerRegistry } from './outbox/outbox.dispatcher';
import { OUTBOX_HANDLER_REGISTRY } from './outbox/event-envelope';
import { OutboxRelayRunner } from './outbox/relay.runner';
import { ScheduledJobRegistry, SCHEDULED_JOB_REGISTRY } from './jobs/scheduled-job.registry';
import { ScheduledJobsRunner } from './jobs/jobs.runner';
import { QUOTA_SERVICE } from './quota/quota.service';
import { PgQuotaService } from './quota/quota.service.pg';
import { IDEMPOTENCY_SERVICE } from './idempotency/idempotency.service';
import { PgIdempotencyService } from './idempotency/idempotency.service.pg';
import { METRICS } from './observability/metrics';
import { ResilienceService, RESILIENCE } from './resilience/resilience.service';
import { WALLET_SERVICE } from './wallet/wallet.port';
import { InProcessWalletClient } from './wallet/wallet.client.inprocess';
import { LedgerRepository } from './wallet/ledger.repository';
import { ReconciliationService } from './wallet/reconciliation.service';
import { PromMetrics } from './observability/metrics.prom';
import { AppConfig } from './config/app-config';
import { FlagsService } from './feature-flags/flags.service';
import { REALTIME_PUBLISHER, NoopRealtimePublisher } from './realtime/realtime-publisher';
import { RedisRealtimePublisher } from './realtime/realtime-publisher.redis';
import { RealtimeFanoutRegistrar } from './realtime/realtime.registrar';

import { AuthGuard } from './auth/auth.guard';
import { PermissionsGuard } from './auth/permissions.guard';
import { TenantResolver } from './tenancy-context/tenant-resolver';
import { TenantSlugResolver } from './tenancy-context/tenant-slug-resolver';
import { TenantContextMiddleware } from './tenancy-context/tenant-context.middleware';
// PC-56 ADMIN-9b: the honouring half of impersonation. admin-api has minted act-as tokens since 0038 and this realm
// had no verifier, so every W008 promise described behaviour that did not exist.
import { ImpersonationGate } from './auth/impersonation.gate';
import { ImpersonationReadOnlyGuard } from './auth/impersonation-read-only.guard';
import { ImpersonationInterceptor } from './auth/impersonation.interceptor';
import { RequestIdMiddleware } from './http/request-id.middleware';
import { SecurityHeadersMiddleware } from './http/security-headers.middleware';
import { HttpLogMiddleware } from './http/http-log.middleware';
import { AllExceptionsFilter } from './http/exception.filter';
import { ResponseInterceptor } from './http/response.interceptor';
import { BackpressureInterceptor } from './backpressure/backpressure.interceptor';
import { CellGuard } from './cells/cell.guard';

import { HealthController } from './health/health.controller';
import { MetricsController } from './observability/metrics.controller';
import { StorefrontBrandingController } from './tenancy-context/storefront-branding.controller';

@Global()
@Module({
  imports: [ConfigModule, DatabaseModule, CacheModule, SearchModule, AuditModule, FeatureFlagsModule, I18nModule],
  controllers: [HealthController, MetricsController, StorefrontBrandingController],
  providers: [
    { provide: OUTBOX_WRITER, useClass: PgOutboxWriter },
    { provide: QUOTA_SERVICE, useClass: PgQuotaService },
    { provide: IDEMPOTENCY_SERVICE, useClass: PgIdempotencyService },
    PromMetrics,
    { provide: METRICS, useExisting: PromMetrics },
    ResilienceService, { provide: RESILIENCE, useExisting: ResilienceService },
    LedgerRepository, InProcessWalletClient, { provide: WALLET_SERVICE, useExisting: InProcessWalletClient },
    ReconciliationService,
    OutboxHandlerRegistry, { provide: OUTBOX_HANDLER_REGISTRY, useExisting: OutboxHandlerRegistry },
    // KV-BL-063: drains OUTBOX_HANDLER_REGISTRY on an in-process timer (OnApplicationBootstrap, once
    // every module's onModuleInit has registered its handlers — RealtimeFanoutRegistrar just below,
    // OrdersModule, PaymentsModule, …). Own dedicated kv_relay pool; see relay.runner.ts.
    OutboxRelayRunner,
    // P0-9-follow-on: registry + runner for the pilot's CADENCE-driven domain-handler jobs (settlement
    // statement generation, …) — the time-based sibling of OutboxRelayRunner above. Modules register a
    // ScheduledJob into SCHEDULED_JOB_REGISTRY at their own onModuleInit (see payments.module.ts); the
    // runner starts OnApplicationBootstrap once every module has registered. Own dedicated kv_relay
    // pool; see core/jobs/jobs.runner.ts.
    ScheduledJobRegistry, { provide: SCHEDULED_JOB_REGISTRY, useExisting: ScheduledJobRegistry },
    ScheduledJobsRunner,
    // realtime fan-out: bridge selected outbox events → Redis Pub/Sub for the realtime-gateway pods.
    // Redis-backed when REDIS_URL is set, else a no-op (Law 12: the platform runs fine without live fan-out).
    // Uses a DEDICATED pub connection (pub/sub must not share the cache client). Gated by `realtime_fanout`.
    {
      provide: REALTIME_PUBLISHER,
      useFactory: (config: AppConfig, resilience: ResilienceService) => {
        const url = config.redis.url;
        if (!url) return new NoopRealtimePublisher();
        return new RedisRealtimePublisher(new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false }), resilience);
      },
      inject: [AppConfig, ResilienceService],
    },
    RealtimeFanoutRegistrar,
    AuthGuard, PermissionsGuard,
    ImpersonationGate, ImpersonationReadOnlyGuard, ImpersonationInterceptor,
    TenantResolver, TenantSlugResolver, TenantContextMiddleware, RequestIdMiddleware, SecurityHeadersMiddleware,
    HttpLogMiddleware,
    // auth + RBAC platform services (used by the identity module's auth flow)
    TokenService, { provide: TOKEN_SERVICE, useExisting: TokenService },
    OtpService, { provide: OTP_SERVICE, useExisting: OtpService },
    RefreshTokenService,
    RoleCacheService, { provide: ROLE_CACHE_SERVICE, useExisting: RoleCacheService },
    // SMS provider chosen by config: msg91 (Indian DLT) / twilio (global) / noop (dev) — factory extracted to
    // sms-sender.provider.ts [DEV-31] so the config-driven driver selection is independently unit-testable.
    smsSenderProvider,
    // global error envelope + success envelope
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: CellGuard }, // PC-53: residency guard — strict no-op until a second cell exists
    { provide: APP_INTERCEPTOR, useClass: BackpressureInterceptor }, // PC-51: FIRST — shed cheaply before any work
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_GUARD, useClass: RateLimitGuard },  // global edge rate limit (per-route @RateLimit overrides)
    // PC-56 ADMIN-9b. GLOBAL, not a decorator: a read-only rule that has to be remembered on each new route is a rule
    // that will be forgotten on one. The guard refuses a mutating method under an act-as token; the interceptor checks
    // the grant is still live and writes the per-request record W008 promises.
    { provide: APP_GUARD, useClass: ImpersonationReadOnlyGuard },
    { provide: APP_INTERCEPTOR, useClass: ImpersonationInterceptor },
  ],
  exports: [
    OUTBOX_WRITER, QUOTA_SERVICE, IDEMPOTENCY_SERVICE, METRICS, PromMetrics,
    ImpersonationGate,
    ResilienceService, RESILIENCE,
    WALLET_SERVICE, InProcessWalletClient, LedgerRepository, ReconciliationService,
    OutboxHandlerRegistry, OUTBOX_HANDLER_REGISTRY,
    ScheduledJobRegistry, SCHEDULED_JOB_REGISTRY,
    AuthGuard, PermissionsGuard,
    ImpersonationGate, ImpersonationReadOnlyGuard, ImpersonationInterceptor, TenantResolver, TenantSlugResolver, TenantContextMiddleware, RequestIdMiddleware, SecurityHeadersMiddleware,
    HttpLogMiddleware,
    TokenService, TOKEN_SERVICE, OtpService, OTP_SERVICE, RefreshTokenService,
    RoleCacheService, ROLE_CACHE_SERVICE, SMS_SENDER,
    ConfigModule, DatabaseModule, CacheModule, SearchModule, AuditModule, FeatureFlagsModule, I18nModule,
  ],
})
export class CoreModule {}
