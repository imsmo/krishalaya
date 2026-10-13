// modules/identity/controllers/v1/onboarding.controller.ts · self-serve onboarding (KV-BL-066).
// Deliberately permission-less (@RequirePermissions is NOT used): the caller is granting themselves
// a role on their own user, same self-service posture as identity.policies.ts documents for other
// self-service endpoints. Gated instead by: auth (must be OTP-logged-in), the `selfserve_onboarding`
// feature flag (Law 10 kill-switch — 404 when off, see FeatureFlagGuard), and a per-user rate limit
// (Law 12 — this isn't a "call repeatedly" endpoint).
import { Controller, Headers, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { clientIpOf } from '../../../../core/http/client-ip';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { RateLimit } from '../../../../core/http/rate-limit.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../../core/idempotency/idempotency.service';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { OnboardingService } from '../../services/onboarding.service';
import { OnboardRoleSchema, OnboardRoleDto } from '../../dto/onboard-role.dto';

// PC-56 STORE-1a · A1: the audit IP is the SAME answer the rate limit counted (core/http/client-ip — the storefront's signed address when it
// verifies, else Express's trust-proxy `req.ip`). The raw, client-supplied X-Forwarded-For this used to read was spoofable.
const ipOf = (req: Request) => clientIpOf(req);

@Controller({ path: 'onboarding', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('selfserve_onboarding')
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
  ) {}

  @Post('roles')
  @RateLimit({ limit: 10, windowSec: 60, by: 'user' })
  async grantRole(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @ZodBody(OnboardRoleSchema) dto: OnboardRoleDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    const data = await this.idem.remember(key, ctx.userId, 'identity.onboarding.grant_role', () => this.onboarding.grantRole(ctx.tenantId, ctx.userId, dto, ipOf(req)));
    return { data };
  }
}
