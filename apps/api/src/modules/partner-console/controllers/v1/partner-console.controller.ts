// modules/partner-console/controllers/v1/partner-console.controller.ts · PC-56 PARTNER-0 — THE PARTNER CONSOLE REALM: `/v1/partner/*`.
//
// Every controller here runs PartnerConsoleFlagGuard (flag `partner_console`, platform-scoped, OFF → 404 on every route) → PartnerSessionGuard
// (a PARTNER token: realm + pid, no tid; a tenant token is 401 PARTNER_SESSION_REQUIRED) → PartnerPermissionsGuard (every route DECLARES what
// it needs; one that declares nothing is refused). None of them uses the tenant AuthGuard / PermissionsGuard: an FPO's tenant_admin or
// banker holding `loan.manage` holds NOTHING here (their token is a tenant token). The machine realm `/v1/partner-api/*` (API keys, 0090) is
// a different controller and is untouched (still behind `partner_api`, still OFF).
import { Controller, Get, Headers, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { clientIpOf } from '../../../../core/http/client-ip';
import { RateLimit } from '../../../../core/http/rate-limit.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import {
  CurrentPartnerSession, PartnerAnyMember, PartnerConsoleFlagGuard, PartnerInsuranceFlagGuard, PartnerPermissions, PartnerPermissionsGuard, PartnerPublic, PartnerSession,
  PartnerSessionGuard,
} from '../../guards/partner-session.guard';
import { PartnerAuthService } from '../../services/partner-auth.service';
import { PartnerApplicationsService } from '../../services/partner-applications.service';
import { PartnerTeamService } from '../../services/partner-team.service';
import { PartnerDashboardService } from '../../services/partner-dashboard.service';
import { PartnerKeysService } from '../../services/partner-keys.service';
import { PartnerWebhooksService } from '../../services/partner-webhooks.service';
import { PartnerReadinessService } from '../../services/partner-readiness.service';
import { PartnerInsuranceService } from '../../services/partner-insurance.service';
import { PartnerLoanProductsService } from '../../services/partner-loan-products.service';
import {
  PartnerAcceptInviteDto, PartnerAcceptInviteSchema, PartnerApplicationsQueryDto, PartnerApplicationsQuerySchema, PartnerApproveDto, PartnerApproveSchema,
  PartnerInviteDto, PartnerInviteSchema, PartnerOtpDto, PartnerOtpSchema, PartnerReasonDto, PartnerReasonSchema, PartnerRefreshDto, PartnerRefreshSchema,
  PartnerRejectDto, PartnerRejectSchema, PartnerTotpCodeDto, PartnerTotpCodeSchema, PartnerTwoFactorDto, PartnerTwoFactorSchema,
  PartnerVerifyDto, PartnerVerifySchema, PartnerInviteLookupDto, PartnerInviteLookupSchema, PartnerKeyRevokeDto, PartnerKeyRevokeSchema,
  PartnerDeliveriesQueryDto, PartnerDeliveriesQuerySchema, PartnerPoliciesQueryDto, PartnerPoliciesQuerySchema, PartnerIssuanceQueryDto, PartnerIssuanceQuerySchema,
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

/** Public invite page: lookup + accept (the token AND an OTP on the invited phone). PC-56 PARTNER-1b · D4: the lookup is a POST with the token
 *  in the BODY (`GET /v1/partner/invites/:token` is gone — a token in a URL lands in access logs; the tenant's `auth/invites/lookup` shape). */
@Controller({ path: 'partner/invites', version: '1' })
@UseGuards(PartnerConsoleFlagGuard, PartnerSessionGuard, PartnerPermissionsGuard)
export class PartnerInvitesController {
  constructor(private readonly team: PartnerTeamService) {}

  @PartnerPublic() @RateLimit({ limit: 10, windowSec: 60, by: 'ip' }) @Post('accept')
  accept(@Req() req: Request, @ZodBody(PartnerAcceptInviteSchema) dto: PartnerAcceptInviteDto) { return this.team.accept(dto, ipOf(req)).then((data) => ({ data })); }

  @PartnerPublic() @RateLimit({ limit: 20, windowSec: 60, by: 'ip' }) @Post('lookup')
  lookup(@ZodBody(PartnerInviteLookupSchema) dto: PartnerInviteLookupDto) { return this.team.lookup(dto.token).then((data) => ({ data })); }
}

/** PC-56 PARTNER-1a · founder D1 — the dashboard's six figures, computed on the server from this partner's own book (`partner.dashboard.read` IS
 *  `partner.applications.read`: the figures are counts over the same consented applications the list shows, plus the 0090 loan book). */
@Controller({ path: 'partner/dashboard', version: '1' })
@UseGuards(PartnerConsoleFlagGuard, PartnerSessionGuard, PartnerPermissionsGuard)
export class PartnerDashboardController {
  constructor(private readonly dashboard: PartnerDashboardService) {}

  @PartnerPermissions('partner.applications.read') @Get()
  read(@CurrentPartnerSession() s: PartnerSession) { return this.dashboard.read(s).then((data) => ({ data })); }
}

/** PC-56 PARTNER-1b · founder D1 — the partner's OWN API keys: read (every partner role) and REVOKE one with a reason (partner_admin). Mint, rotate,
 *  re-scope and the quota stay with the platform's partner operations (the console prints that refusal). */
@Controller({ path: 'partner/keys', version: '1' })
@UseGuards(PartnerConsoleFlagGuard, PartnerSessionGuard, PartnerPermissionsGuard)
export class PartnerKeysController {
  constructor(private readonly keys: PartnerKeysService) {}

  @PartnerPermissions('partner.keys.read') @Get()
  list(@CurrentPartnerSession() s: PartnerSession) { return this.keys.list(s).then((r) => ({ data: r.items, meta: { computedAt: r.computedAt } })); }

  @PartnerPermissions('partner.keys.read', 'partner.keys.revoke') @HttpCode(200) @Post(':id/revoke')
  revoke(@CurrentPartnerSession() s: PartnerSession, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(PartnerKeyRevokeSchema) dto: PartnerKeyRevokeDto) {
    return this.keys.revoke(s, id, dto.reason, key).then((data) => ({ data }));
  }
}

/** PC-56 PARTNER-1b · founder D2 — the partner's OWN webhook endpoints and deliveries, READ-ONLY (never a secret, never a payload, never the tenant). */
@Controller({ path: 'partner/webhooks', version: '1' })
@UseGuards(PartnerConsoleFlagGuard, PartnerSessionGuard, PartnerPermissionsGuard)
export class PartnerWebhooksController {
  constructor(private readonly hooks: PartnerWebhooksService) {}

  @PartnerPermissions('partner.webhooks.read') @Get()
  endpoints(@CurrentPartnerSession() s: PartnerSession) {
    return this.hooks.endpoints(s).then((r) => ({ data: r.items, meta: { subscribableEvents: r.subscribableEvents, retentionDays: r.retentionDays, computedAt: r.computedAt } }));
  }

  @PartnerPermissions('partner.webhooks.read') @Get('deliveries')
  deliveries(@CurrentPartnerSession() s: PartnerSession, @ZodQuery(PartnerDeliveriesQuerySchema) q: PartnerDeliveriesQueryDto) {
    return this.hooks.deliveries(s, q).then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor, limit: r.limit, retentionDays: r.retentionDays, computedAt: r.computedAt } }));
  }

  @PartnerPermissions('partner.webhooks.read') @Get('deliveries/:id')
  delivery(@CurrentPartnerSession() s: PartnerSession, @Param('id') id: string) { return this.hooks.delivery(s, id).then((data) => ({ data })); }
}

/** PC-56 PARTNER-1b · founder D3 — readiness: what the platform has set up for this partner, from facts (any member; counts and yes / no only). */
@Controller({ path: 'partner/readiness', version: '1' })
@UseGuards(PartnerConsoleFlagGuard, PartnerSessionGuard, PartnerPermissionsGuard)
export class PartnerReadinessController {
  constructor(private readonly readiness: PartnerReadinessService) {}

  @PartnerAnyMember() @Get()
  read(@CurrentPartnerSession() s: PartnerSession) { return this.readiness.read(s).then((data) => ({ data })); }
}

/** PC-56 PARTNER-2a · founder Q6 — THE INSURER READS ITS OWN BOOK: its own products and the policy FACTS on them (never a policyholder's
 *  identity), every read audited. Behind `partner_console` AND the platform's `insurance` flag (OFF → 404 `PARTNER_INSURANCE_SWITCHED_OFF`).
 *  Read-only: no product write, no issuance, no export, no cancel / endorse — refused by name in the console.
 *  PC-56 PARTNER-2b (founder Q5) + `GET issuance`: the `proposed` queue on the insurer's own products, a READ — there is NO route to issue a
 *  policy, export a file or run a parametric payout (the live spec pins their absence). */
@Controller({ path: 'partner/insurance', version: '1' })
@UseGuards(PartnerConsoleFlagGuard, PartnerSessionGuard, PartnerPermissionsGuard, PartnerInsuranceFlagGuard)
export class PartnerInsuranceController {
  constructor(private readonly insurance: PartnerInsuranceService) {}

  @PartnerPermissions('partner.insurance.read') @Get('dashboard')
  dashboard(@CurrentPartnerSession() s: PartnerSession) { return this.insurance.dashboard(s).then((data) => ({ data })); }

  @PartnerPermissions('partner.insurance.read') @Get('products')
  products(@CurrentPartnerSession() s: PartnerSession) { return this.insurance.products(s).then((r) => ({ data: r.items, meta: { computedAt: r.computedAt } })); }

  @PartnerPermissions('partner.insurance.read') @Get('products/:id')
  product(@CurrentPartnerSession() s: PartnerSession, @Param('id') id: string) { return this.insurance.product(s, id).then((data) => ({ data })); }

  @PartnerPermissions('partner.insurance.read') @Get('policies')
  policies(@CurrentPartnerSession() s: PartnerSession, @ZodQuery(PartnerPoliciesQuerySchema) q: PartnerPoliciesQueryDto) {
    return this.insurance.policies(s, q).then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor, limit: r.limit, computedAt: r.computedAt } }));
  }

  @PartnerPermissions('partner.insurance.read') @Get('policies/:id')
  policy(@CurrentPartnerSession() s: PartnerSession, @Param('id') id: string) { return this.insurance.policy(s, id).then((data) => ({ data })); }

  @PartnerPermissions('partner.insurance.read') @Get('issuance')
  issuance(@CurrentPartnerSession() s: PartnerSession, @ZodQuery(PartnerIssuanceQuerySchema) q: PartnerIssuanceQueryDto) {
    return this.insurance.issuance(s, q).then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor, limit: r.limit, computedAt: r.computedAt } }));
  }
}

/** PC-56 PARTNER-2c · founder Q7 — THE LENDER'S SHELF: this lender's OWN loan products' terms (0229's definer — never another lender's) with,
 *  per product, the COUNT of its CONSENTED applications in the last 30 days (0225's axis), every read audited (`partner.products.read`, counts
 *  only). Guarded by `partner.applications.read` (every partner role — no new permission). READ-ONLY: there is NO POST / PATCH route — loan
 *  products are authored by the platform (the console prints that refusal); the live spec pins the absence. */
@Controller({ path: 'partner/loan-products', version: '1' })
@UseGuards(PartnerConsoleFlagGuard, PartnerSessionGuard, PartnerPermissionsGuard)
export class PartnerLoanProductsController {
  constructor(private readonly products: PartnerLoanProductsService) {}

  @PartnerPermissions('partner.applications.read') @Get()
  list(@CurrentPartnerSession() s: PartnerSession) {
    return this.products.list(s).then((r) => ({ data: r.items, meta: { computedAt: r.computedAt, windowDays: r.windowDays } }));
  }

  @PartnerPermissions('partner.applications.read') @Get(':id')
  get(@CurrentPartnerSession() s: PartnerSession, @Param('id') id: string) { return this.products.get(s, id).then((data) => ({ data })); }
}

/** For the route-uniqueness spec and the module: every controller of the realm. */
export const PARTNER_CONSOLE_CONTROLLERS = [PartnerAuthController, PartnerMeController, PartnerApplicationsController, PartnerTeamController, PartnerInvitesController, PartnerDashboardController,
  PartnerKeysController, PartnerWebhooksController, PartnerReadinessController, PartnerInsuranceController, PartnerLoanProductsController];
