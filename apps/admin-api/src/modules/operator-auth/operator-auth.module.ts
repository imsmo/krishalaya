// apps/admin-api/src/modules/operator-auth/operator-auth.module.ts · PC-56 ADMIN-AUTH-1 — operator sign-in for the god-mode realm:
// OpenID Connect (Google Workspace by default) + a mandatory WebAuthn hardware key, step-up, sign-out, keys and enrollment codes.
// Config, pool, audit writer, guards and the operator registry come from the @Global AdminCoreModule.
import { Module } from '@nestjs/common';
import { AdminConfig } from '../../core/config/admin-config';
import { OperatorAuthController } from './operator-auth.controller';
import { AuthRateLimitGuard } from './operator-auth.rate-limit';
import { OperatorAuthRepository } from './repositories/operator-auth.repository';
import { OperatorAuthService } from './services/operator-auth.service';
import { OidcClient } from './services/oidc-client';

@Module({
  controllers: [OperatorAuthController],
  providers: [
    OperatorAuthRepository, OperatorAuthService, AuthRateLimitGuard,
    // A factory: OidcClient's optional ctor params (fetch, clock) are for tests and must not be resolved by Nest.
    { provide: OidcClient, useFactory: (config: AdminConfig) => new OidcClient(config), inject: [AdminConfig] },
  ],
})
export class OperatorAuthModule {}
