// apps/admin-api/src/core/admin-core.module.ts · the @Global core of the god-mode realm: config, the kv_admin
// pool, admin-JWT auth + owner RBAC guards, the FIDO2/step-up elevation guards, and the in-tx audit writer.
// Global so every ops module's controllers can resolve the guards (@UseGuards) and inject the pool/audit without
// re-importing. Mirrors apps/api's CoreModule pattern.
import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AdminConfig } from './config/admin-config';
import { AdminPool } from './database/admin-pool';
import { AdminAuditWriter } from './audit/admin-audit.writer';
import { AdminAuditInterceptor } from './audit/admin-audit.interceptor';
import { AdminAuthGuard } from './auth/admin-auth.guard';
import { HardwareKeyGuard } from './auth/hardware-key.guard';
import { StepUpReauthGuard } from './auth/step-up-reauth.guard';
import { OwnerPermissionsGuard } from './rbac/owner-roles';
import { IpAllowlistMiddleware } from './auth/ip-allowlist.middleware';
import { AdminObjectStore } from './media/admin-object-store';
// PC-56 ADMIN-9: the operator registry lives in core because AdminAuthGuard reads it on EVERY request. One repository
// for these four tables rather than one in core and one in the module — two mappers over one table is how the console
// starts disagreeing with the guard about who is suspended.
import { OperatorRegistryRepository } from './auth/operator-registry.repository';

@Global()
@Module({
  providers: [
    // AdminConfig's ctor param is `Record<string, unknown>`, which TypeScript erases to
    // `Object` in design:paramtypes — Nest would try to INJECT a provider for Object and
    // fail ("can't resolve dependencies of the AdminConfig (?)"). A factory hands it
    // process.env explicitly, mirroring apps/api/src/core/config/config.module.ts.
    { provide: AdminConfig, useFactory: () => new AdminConfig(process.env) },
    AdminPool, AdminAuditWriter, AdminObjectStore, IpAllowlistMiddleware, OperatorRegistryRepository,
    AdminAuthGuard, HardwareKeyGuard, StepUpReauthGuard, OwnerPermissionsGuard,
    { provide: APP_INTERCEPTOR, useClass: AdminAuditInterceptor },
  ],
  exports: [AdminObjectStore, AdminConfig, AdminPool, AdminAuditWriter, OperatorRegistryRepository, IpAllowlistMiddleware, AdminAuthGuard, HardwareKeyGuard, StepUpReauthGuard, OwnerPermissionsGuard],
})
export class AdminCoreModule {}
