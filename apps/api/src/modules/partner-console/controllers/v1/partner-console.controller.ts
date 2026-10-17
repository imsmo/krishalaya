// modules/partner-console/controllers/v1/partner-console.controller.ts · PC-56 PARTNER-0 — THE PARTNER CONSOLE REALM: `/v1/partner/*`.
//
// Every controller here runs PartnerConsoleFlagGuard (flag `partner_console`, platform-scoped, OFF → 404 on every route) → PartnerSessionGuard
// (a PARTNER token: realm + pid, no tid; a tenant token is 401 PARTNER_SESSION_REQUIRED) → PartnerPermissionsGuard (every route DECLARES what
// it needs; one that declares nothing is refused). None of them uses the tenant AuthGuard / PermissionsGuard: an FPO's tenant_admin or
// banker holding `loan.manage` holds NOTHING here (their token is a tenant token). The machine realm `/v1/partner-api/*` (API keys, 0090) is
// a different controller and is untouched (still behind `partner_api`, still OFF).
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { clientIpOf } from '../../../../core/http/client-ip';
import { RateLimit } from '../../../../core/http/rate-limit.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import {
  CurrentPartnerSession, PartnerAnyMember, PartnerConsoleFlagGuard, PartnerPermissions, PartnerPermissionsGuard, PartnerPublic, PartnerSession, PartnerSessionGuard,
} from '../../guards/partner-session.guard';
import { PartnerAuthService } from '../../services/partner-auth.service';
import { PartnerApplicationsService } from '../../services/partner-applications.service';
import { PartnerTeamService } from '../../services/partner-team.service';
import {
  PartnerAcceptInviteDto, PartnerAcceptInviteSchema, PartnerApplicationsQueryDto, PartnerApplicationsQuerySchema, PartnerApproveDto, PartnerApproveSchema,
  PartnerInviteDto, PartnerInviteSchema, PartnerOtpDto, PartnerOtpSchema, PartnerReasonDto, PartnerReasonSchema, PartnerRefreshDto, PartnerRefreshSchema,
  PartnerRejectDto, PartnerRejectSchema, PartnerTotpCodeDto, PartnerTotpCodeSchema, PartnerTwoFactorDto, PartnerTwoFactorSchema,
  PartnerVerifyDto, PartnerVerifySchema,
} from '../../dto/partner-console.dto';

const ipOf = (req: Request) => clientIpOf(req);

/** Sign-in to the partner (public), refresh (public — the refresh token is the credential), sign-out (a partner session). */
@Controller({ path: 'partner/auth', version: '1' })
@UseGuards(PartnerConsoleFlagGuard, PartnerSessionGuard, PartnerPermissionsGuard)
export class PartnerAuthController {
  constructor(private readonly auth: PartnerAuthService) {}

  @PartnerPublic() @RateLimit({ limit: 5, windowSec: 60, by: 'ip' }) @Post('otp')
  otp(@ZodBody(PartnerOtpSchema) dto: PartnerOtpDto) { return this.auth.requestOtp(dto.phone).then((data) => ({ data })); }

  @PartnerPublic() @RateLimit({ limit: 10, windowSec: 60, by: 'ip' }) @Post('verify')
  verify(@Req() req: Request, @ZodBody(PartnerVerifySchema) dto: PartnerVerifyDto) { return this.auth.verify(dto, ipOf(req)).then((data) => ({ data })); }

  @PartnerPublic() @RateLimit({ limit: 10, windowSec: 60, by: 'ip' }) @Post('2fa/verify')
  verifyTwoFactor(@Req() req: Request, @ZodBody(PartnerTwoFactorSchema) dto: PartnerTwoFactorDto) { return this.auth.verifyTwoFactor(dto, ipOf(req)).then((data) => ({ data })); }

  @PartnerPublic() @RateLimit({ limit: 30, windowSec: 60, by: 'ip' }) @Post('refresh')
  refresh(@Req() req: Request, @ZodBody(PartnerRefreshSchema) dto: PartnerRefreshDto) { return this.auth.refresh(dto.refreshToken, ipOf(req)).then((data) => ({ data })); }

  @PartnerAnyMember() @Post('logout')
  logout(@CurrentPartnerSession() s: PartnerSession) { return this.auth.logout(s).then((data) => ({ data })); }
}

/** The organisation and the person; the person's OWN second factor (TOTP — never a hardware-key claim). */
@Controller({ path: 'partner/me', version: '1' })
@UseGuards(PartnerConsoleFlagGuard, PartnerSessionGuard, PartnerPermissionsGuard)
export class PartnerMeController {
  constructor(private readonly auth: PartnerAuthService) {}

  @PartnerAnyMember() @Get()
  me(@CurrentPartnerSession() s: PartnerSession) { return this.auth.me(s).then((data) => ({ data })); }

  @PartnerAnyMember() @Get('2fa')
  twoFactor(@CurrentPartnerSession() s: PartnerSession) { return this.auth.twoFactorState(s).then((data) => ({ data })); }

  @PartnerAnyMember() @RateLimit({ limit: 10, windowSec: 60, by: 'ip' }) @Post('2fa/enrol')
  enrol(@CurrentPartnerSession() s: PartnerSession) { return this.auth.twoFactorEnrol(s).then((data) => ({ data })); }

  @PartnerAnyMember() @RateLimit({ limit: 10, windowSec: 60, by: 'ip' }) @Post('2fa/confirm')
  confirm(@CurrentPartnerSession() s: PartnerSession, @ZodBody(PartnerTotpCodeSchema) dto: PartnerTotpCodeDto) { return this.auth.twoFactorConfirm(s, dto.code).then((data) => ({ data })); }
}

/** The consent-gated applications read and the decisions (never disburse). */
@Controller({ path: 'partner/applications', version: '1' })
@UseGuards(PartnerConsoleFlagGuard, PartnerSessionGuard, PartnerPermissionsGuard)
export class PartnerApplicationsController {
  constructor(private readonly apps: PartnerApplicationsService) {}

  @PartnerPermissions('partner.applications.read') @Get()
  list(@CurrentPartnerSession() s: PartnerSession, @ZodQuery(PartnerApplicationsQuerySchema) q: PartnerApplicationsQueryDto) {
    return this.apps.list(s, { status: q.status, reviewQueue: q.reviewQueue === 'true', cursor: q.cursor, limit: q.limit })
      .then((page) => ({ data: page.items, meta: { nextCursor: page.nextCursor, limit: page.limit, asOf: page.asOf } }));
  }

  @PartnerPermissions('partner.applications.read') @Get(':id')
  detail(@CurrentPartnerSession() s: PartnerSession, @Param('id') id: string) { return this.apps.detail(s, id).then((data) => ({ data })); }

  @PartnerPermissions('partner.applications.read', 'partner.applications.review') @Post(':id/review')
  review(@CurrentPartnerSession() s: PartnerSession, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    return this.apps.decide(s, id, 'review', {}, key).then((data) => ({ data }));
  }

  @PartnerPermissions('partner.applications.read', 'partner.applications.decide') @Post(':id/approve')
  approve(@CurrentPartnerSession() s: PartnerSession, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(PartnerApproveSchema) dto: PartnerApproveDto) {
    return this.apps.decide(s, id, 'approve', dto, key).then((data) => ({ data }));
  }

  @PartnerPermissions('partner.applications.read', 'partner.applications.decide') @Post(':id/reject')
  reject(@CurrentPartnerSession() s: PartnerSession, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(PartnerRejectSchema) dto: PartnerRejectDto) {
    return this.apps.decide(s, id, 'reject', dto, key).then((data) => ({ data }));
  }

  /** REFUSED BY NAME (founder D3): disbursal moves the FPO's wallet money — the FPO is the lender of record and disburses from its console. */
  @PartnerAnyMember() @Post(':id/disburse')
  disburse() { return this.apps.refuseDisburse(); }
}

/** The partner's own team (partner_admin: `partner.team.manage`). */
@Controller({ path: 'partner/team', version: '1' })
@UseGuards(PartnerConsoleFlagGuard, PartnerSessionGuard, PartnerPermissionsGuard)
export class PartnerTeamController {
  constructor(private readonly team: PartnerTeamService) {}

  @PartnerPermissions('partner.team.manage') @Get()
  list(@CurrentPartnerSession() s: PartnerSession) { return this.team.team(s).then((data) => ({ data })); }

  @PartnerPermissions('partner.team.manage') @RateLimit({ limit: 20, windowSec: 60, by: 'ip' }) @Post('invites')
  invite(@CurrentPartnerSession() s: PartnerSession, @Headers('idempotency-key') key: string, @ZodBody(PartnerInviteSchema) dto: PartnerInviteDto) {
    return this.team.invite(s, dto, key).then((data) => ({ data }));
  }

  @PartnerPermissions('partner.team.manage') @Post('invites/:id/revoke')
  revoke(@CurrentPartnerSession() s: PartnerSession, @Param('id') id: string, @ZodBody(PartnerReasonSchema) dto: PartnerReasonDto) {
    return this.team.revokeInvite(s, id, dto.reason).then((data) => ({ data }));
  }

  @PartnerPermissions('partner.team.manage') @Post('members/:id/remove')
  remove(@CurrentPartnerSession() s: PartnerSession, @Param('id') id: string, @ZodBody(PartnerReasonSchema) dto: PartnerReasonDto) {
    return this.team.removeMember(s, id, dto.reason).then((data) => ({ data }));
  }
}

/** Public invite page: lookup + accept (the token AND an OTP on the invited phone). */
@Controller({ path: 'partner/invites', version: '1' })
@UseGuards(PartnerConsoleFlagGuard, PartnerSessionGuard, PartnerPermissionsGuard)
export class PartnerInvitesController {
  constructor(private readonly team: PartnerTeamService) {}

  @PartnerPublic() @RateLimit({ limit: 10, windowSec: 60, by: 'ip' }) @Post('accept')
  accept(@Req() req: Request, @ZodBody(PartnerAcceptInviteSchema) dto: PartnerAcceptInviteDto) { return this.team.accept(dto, ipOf(req)).then((data) => ({ data })); }

  @PartnerPublic() @RateLimit({ limit: 20, windowSec: 60, by: 'ip' }) @Get(':token')
  lookup(@Param('token') token: string) { return this.team.lookup(token).then((data) => ({ data })); }
}

/** For the route-uniqueness spec and the module: every controller of the realm. */
export const PARTNER_CONSOLE_CONTROLLERS = [PartnerAuthController, PartnerMeController, PartnerApplicationsController, PartnerTeamController, PartnerInvitesController];
