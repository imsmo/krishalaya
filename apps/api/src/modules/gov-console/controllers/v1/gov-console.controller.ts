// modules/gov-console/controllers/v1/gov-console.controller.ts · PC-56 GOV-0 — THE GOVERNMENT CONSOLE REALM: `/v1/gov/*`.
//
// Every controller runs GovConsoleFlagGuard (flag `gov_console`, platform-scoped, OFF → 404 on every route) → GovSessionGuard (a GOV token:
// realm 'gov' + aid, no tid, no pid; a tenant or partner token is 401 GOV_SESSION_REQUIRED) → GovPermissionsGuard (every route DECLARES what
// it needs). None uses the tenant AuthGuard / PermissionsGuard: an organisation's administrator holds NOTHING here.
// NOT HERE, by GOV-1 Q5-A: government SSO, a departmental ID, a hardware key — no such route exists (a call answers 404). NOT HERE, by the
// brief: any write on an application (GOV-2's doors). The first head is appointed in the ADMIN realm (apps/admin-api, FIDO2 + step-up).
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { clientIpOf } from '../../../../core/http/client-ip';
import { RateLimit } from '../../../../core/http/rate-limit.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import {
  CurrentGovSession, GovAnyMember, GovConsoleFlagGuard, GovPermissions, GovPermissionsGuard, GovPublic, GovSession, GovSessionGuard,
} from '../../guards/gov-session.guard';
import { GovAuthService } from '../../services/gov-auth.service';
import { GovMembersService } from '../../services/gov-members.service';
import { GovApplicationsService } from '../../services/gov-applications.service';
import {
  GovApplicationsQueryDto, GovApplicationsQuerySchema, GovEnrolConfirmDto, GovEnrolConfirmSchema, GovEnrolDto, GovEnrolSchema,
  GovMemberRequestDto, GovMemberRequestSchema, GovOtpDto, GovOtpSchema, GovReasonDto, GovReasonSchema, GovRefreshDto, GovRefreshSchema,
  GovTwoFactorDto, GovTwoFactorSchema, GovVerifyDto, GovVerifySchema,
} from '../../dto/gov-console.dto';

const ipOf = (req: Request) => clientIpOf(req);

/** Sign-in (phone code → authenticator code), the authenticator set-up step, refresh, sign-out. */
@Controller({ path: 'gov/auth', version: '1' })
@UseGuards(GovConsoleFlagGuard, GovSessionGuard, GovPermissionsGuard)
export class GovAuthController {
  constructor(private readonly auth: GovAuthService) {}

  @GovPublic() @RateLimit({ limit: 5, windowSec: 60, by: 'ip' }) @Post('otp')
  otp(@ZodBody(GovOtpSchema) dto: GovOtpDto) { return this.auth.requestOtp(dto.phone).then((data) => ({ data })); }

  @GovPublic() @RateLimit({ limit: 10, windowSec: 60, by: 'ip' }) @Post('verify')
  verify(@Req() req: Request, @ZodBody(GovVerifySchema) dto: GovVerifyDto) { return this.auth.verify(dto, ipOf(req)).then((data) => ({ data })); }

  @GovPublic() @RateLimit({ limit: 10, windowSec: 60, by: 'ip' }) @Post('2fa/verify')
  verifyTwoFactor(@Req() req: Request, @ZodBody(GovTwoFactorSchema) dto: GovTwoFactorDto) { return this.auth.verifyTwoFactor(dto, ipOf(req)).then((data) => ({ data })); }

  @GovPublic() @RateLimit({ limit: 10, windowSec: 60, by: 'ip' }) @Post('2fa/enrol')
  enrol(@Req() req: Request, @ZodBody(GovEnrolSchema) dto: GovEnrolDto) { return this.auth.enrol(dto.enrolToken, ipOf(req)).then((data) => ({ data })); }

  @GovPublic() @RateLimit({ limit: 10, windowSec: 60, by: 'ip' }) @Post('2fa/confirm')
  confirm(@Req() req: Request, @ZodBody(GovEnrolConfirmSchema) dto: GovEnrolConfirmDto) { return this.auth.confirm(dto.enrolToken, dto.code, ipOf(req)).then((data) => ({ data })); }

  @GovPublic() @RateLimit({ limit: 30, windowSec: 60, by: 'ip' }) @Post('refresh')
  refresh(@Req() req: Request, @ZodBody(GovRefreshSchema) dto: GovRefreshDto) { return this.auth.refresh(dto.refreshToken, ipOf(req)).then((data) => ({ data })); }

  @GovAnyMember() @Post('logout')
  logout(@CurrentGovSession() s: GovSession) { return this.auth.logout(s).then((data) => ({ data })); }
}

/** The authority and the person (the persona). */
@Controller({ path: 'gov/me', version: '1' })
@UseGuards(GovConsoleFlagGuard, GovSessionGuard, GovPermissionsGuard)
export class GovMeController {
  constructor(private readonly auth: GovAuthService) {}

  @GovAnyMember() @Get()
  me(@CurrentGovSession() s: GovSession) { return this.auth.me(s).then((data) => ({ data })); }
}

/** The authority's people: read, request, approve (a second person), remove (one person, at once). */
@Controller({ path: 'gov/members', version: '1' })
@UseGuards(GovConsoleFlagGuard, GovSessionGuard, GovPermissionsGuard)
export class GovMembersController {
  constructor(private readonly members: GovMembersService) {}

  @GovPermissions('authority.members.read') @Get()
  list(@CurrentGovSession() s: GovSession) { return this.members.list(s).then((data) => ({ data })); }

  @GovPermissions('authority.members.request') @RateLimit({ limit: 20, windowSec: 60, by: 'ip' }) @Post('requests')
  request(@CurrentGovSession() s: GovSession, @Headers('idempotency-key') key: string, @ZodBody(GovMemberRequestSchema) dto: GovMemberRequestDto) {
    return this.members.request(s, dto, key).then((data) => ({ data }));
  }

  @GovPermissions('authority.members.approve') @Post(':id/approve')
  approve(@CurrentGovSession() s: GovSession, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    return this.members.approve(s, id, key).then((data) => ({ data }));
  }

  @GovPermissions('authority.members.remove') @Post(':id/remove')
  remove(@CurrentGovSession() s: GovSession, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(GovReasonSchema) dto: GovReasonDto) {
    return this.members.remove(s, id, dto.reason, key).then((data) => ({ data }));
  }
}

/** Applications to the authority's schemes — read only; every opening recorded. */
@Controller({ path: 'gov/applications', version: '1' })
@UseGuards(GovConsoleFlagGuard, GovSessionGuard, GovPermissionsGuard)
export class GovApplicationsController {
  constructor(private readonly apps: GovApplicationsService) {}

  @GovPermissions('authority.applications.read') @Get()
  list(@CurrentGovSession() s: GovSession, @ZodQuery(GovApplicationsQuerySchema) q: GovApplicationsQueryDto) {
    return this.apps.list(s, q).then((page) => ({ data: page.items, meta: { nextCursor: page.nextCursor, limit: page.limit, asOf: page.asOf } }));
  }

  @GovPermissions('authority.applications.read') @Get(':id')
  open(@CurrentGovSession() s: GovSession, @Param('id') id: string) { return this.apps.open(s, id).then((data) => ({ data })); }
}

/** PC-56 GOV-1b · GOV1-B5 — the authority's overview (W325): counts over applications to the schemes it runs, across organisations; no
 *  application id, organisation, applicant, form field or money figure; `computedAt` the server's. Same gate as the list it summarises. */
@Controller({ path: 'gov/overview', version: '1' })
@UseGuards(GovConsoleFlagGuard, GovSessionGuard, GovPermissionsGuard)
export class GovOverviewController {
  constructor(private readonly apps: GovApplicationsService) {}

  @GovPermissions('authority.applications.read') @Get()
  overview(@CurrentGovSession() s: GovSession) { return this.apps.overview(s).then((data) => ({ data })); }
}

export const GOV_CONSOLE_CONTROLLERS = [GovAuthController, GovMeController, GovMembersController, GovApplicationsController, GovOverviewController];
