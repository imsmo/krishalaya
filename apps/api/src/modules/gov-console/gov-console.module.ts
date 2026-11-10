// modules/gov-console/gov-console.module.ts · PC-56 GOV-0 · A GOVERNMENT AUTHORITY IS AN ORGANISATION (GOV-1 Q2-A, Q3-A, Q4-A, Q5-A — applied
// by the lead on 2026-11-10 under the founder's instruction "please choose recommended option and start at your end next step … think as you
// are product owner"; the founder may reopen them).
//
// WHY A NEW MODULE (the partner-console precedent, 0225): the government console is its own REALM — its own token (realm 'gov', aid, no tid,
// no pid), its own guards, its own control-plane table (0239 `authority_memberships`) and its own axis read (`kv_gov`) — and it must never
// be reachable through a tenant guard. It reuses, through PUBLIC services only: identity's AuthService (the ONE place sessions and tokens are
// minted, extended with the gov realm's session acts), UserRepository and TwoFactorService (per-person TOTP, now with a gov actor).
// Flag `gov_console` OFF (0239 / seed 0009): every route answers 404 until it is switched on. No outbox event, no SMS: a role request names
// an existing platform account by phone, and nothing is sent (the console tells the person).
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { GOV_CONSOLE_CONTROLLERS } from './controllers/v1/gov-console.controller';
import { GovConsoleRepository } from './repositories/gov-console.repository';
import { GovAuthService } from './services/gov-auth.service';
import { GovMembersService } from './services/gov-members.service';
import { GovApplicationsService } from './services/gov-applications.service';
import { GovConsoleFlagGuard, GovPermissionsGuard, GovSessionGuard } from './guards/gov-session.guard';

@Module({
  imports: [IdentityModule],
  controllers: [...GOV_CONSOLE_CONTROLLERS],
  providers: [GovConsoleRepository, GovAuthService, GovMembersService, GovApplicationsService, GovConsoleFlagGuard, GovSessionGuard, GovPermissionsGuard],
})
export class GovConsoleModule {}
