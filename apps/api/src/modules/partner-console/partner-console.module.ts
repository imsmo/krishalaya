// modules/partner-console/partner-console.module.ts · PC-56 PARTNER-0 · A PARTNER IS AN ORGANISATION (founder D1–D8, 2026-10-17).
//
// WHY A NEW MODULE (and not identity + fintech extensions): the partner console is its own REALM — its own token (realm 'partner', pid, no
// tid), its own guards, its own control-plane tables (0225) and its own axis reads — and it must never be reachable through a tenant guard.
// It reuses, through PUBLIC services only (the module blueprint): identity's AuthService (the ONE place sessions and tokens are minted —
// extended with the partner realm's session acts), UserRepository (exported by identity, the TenancyModule precedent) and TwoFactorService
// (per-person TOTP, now exported); fintech's LoanApplicationService (the state machine, extended with the partner decision path and the
// tenant-side product-owner rule). Flag `partner_console` OFF (0225 / seed 0009): every route answers 404 until it is switched on.
// Not here, by founder D5: key minting, endpoint writes, a settlement account, an onboarding application. PC-56 PARTNER-1b adds the partner's
// own keys (read + the one REVOKE), endpoints and deliveries (read-only) and the readiness facts — on the kv_partner axis through 0227. PC-56
// PARTNER-2a adds the INSURER's own book (products + policy facts, read-only, every read audited) through 0228; PARTNER-3a the claim FACTS on
// the insurer's own products (read-only, every read audited) through 0230. The machine realm
// `/v1/partner-api/*` (PartnerApiModule, 0090) is untouched and still OFF.
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { FintechModule } from '../fintech/fintech.module';
import { OUTBOX_HANDLER_REGISTRY } from '../../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../../core/outbox/outbox.dispatcher';
import { PartnerRealmUnitOfWork } from '../../core/database/partner-realm-uow';
import { UiMessageRepository } from '../../core/i18n/ui-message.repository';
import { SMS_SENDER, SmsSender } from '../../core/auth/otp.service';
import { AppConfig } from '../../core/config/app-config';
import { resolveKek } from '../../core/secrets/secret-envelope';
import { PARTNER_CONSOLE_CONTROLLERS } from './controllers/v1/partner-console.controller';
import { PartnerConsoleRepository } from './repositories/partner-console.repository';
import { PartnerAuthService } from './services/partner-auth.service';
import { PartnerApplicationsService } from './services/partner-applications.service';
import { PartnerTeamService } from './services/partner-team.service';
import { PartnerDashboardService } from './services/partner-dashboard.service';
import { PartnerKeysService } from './services/partner-keys.service';
import { PartnerWebhooksService } from './services/partner-webhooks.service';
import { PartnerReadinessService } from './services/partner-readiness.service';
import { PartnerInsuranceService } from './services/partner-insurance.service';
import { PartnerLoanProductsService } from './services/partner-loan-products.service';
import { PartnerClaimsService } from './services/partner-claims.service';
import { PartnerConsoleFlagGuard, PartnerInsuranceFlagGuard, PartnerPermissionsGuard, PartnerSessionGuard } from './guards/partner-session.guard';
import { PartnerMemberInvitedHandler } from './events/handlers/partner-member-invited.handler';

@Module({
  imports: [IdentityModule, FintechModule],
  controllers: [...PARTNER_CONSOLE_CONTROLLERS],
  providers: [PartnerConsoleRepository, PartnerAuthService, PartnerApplicationsService, PartnerTeamService, PartnerDashboardService,
    PartnerKeysService, PartnerWebhooksService, PartnerReadinessService, PartnerInsuranceService, PartnerLoanProductsService, PartnerClaimsService,
    PartnerConsoleFlagGuard, PartnerSessionGuard, PartnerPermissionsGuard, PartnerInsuranceFlagGuard, UiMessageRepository],
})
export class PartnerConsoleModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    private readonly uow: PartnerRealmUnitOfWork,
    private readonly repo: PartnerConsoleRepository,
    private readonly ui: UiMessageRepository,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    // the partner-invite SMS (partner.member_invited) — its table work in a partner-realm kv_app UoW (a HOTFIX-2 relay-gate case)
    this.registry.register(new PartnerMemberInvitedHandler(this.uow, this.repo, this.ui, this.sms, resolveKek(this.config.webhookSigningKek, this.config.isProd)));
  }
}
