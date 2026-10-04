// modules/tenancy/controllers/v1/onboarding.controller.ts · PC-56 TENANT-SW-d · W114 + W2693–W2695 — signup STEP 2, the organisation profile.
// Behind the `tenancy` flag (as the profile PATCH always was). Every route is the caller's OWN tenant (no :tenantId — the `tenants`
// wall agrees). The service decides the permission (tenant.settings) so a refusal is a named sentence, never a bare 403.
//   GET  /v1/tenancy/onboarding                 — the step, current values, the OWNER's draft, districts, fields, brand lock
//   PUT  /v1/tenancy/onboarding/draft           — "Save & exit (resume later by OTP)" — a server draft, owner-only, 30 days
//   POST /v1/tenancy/onboarding/profile/preview — W2693's confirm step: every error, the diff, the GSTIN advisory (writes nothing)
//   POST /v1/tenancy/onboarding/profile         — complete the step (Idempotency-Key); `needs_confirm` = the advisory, nothing written
import { Body, Controller, Get, Headers, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { tenantActorOf } from '../../policies/tenancy.policies';
import { OnboardingService } from '../../services/onboarding.service';
import { DraftSchema, ProfileStepDto, ProfileStepSchema } from '../../dto/onboarding-governance.dto';

const needKey = (k?: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };

@Controller({ path: 'tenancy/onboarding', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('tenancy')
export class OnboardingController {
  constructor(private readonly svc: OnboardingService) {}

  @Get()
  state(@CurrentContext() ctx: RequestContext) { return this.svc.state(ctx.tenantId, tenantActorOf(ctx)).then((data) => ({ data })); }

  @Put('draft')
  draft(@CurrentContext() ctx: RequestContext, @ZodBody(DraftSchema) body: { payload: Record<string, string | null> }) {
    return this.svc.saveDraft(ctx.tenantId, tenantActorOf(ctx), body.payload).then((data) => ({ data }));
  }

  @Post('profile/preview')
  preview(@CurrentContext() ctx: RequestContext, @ZodBody(ProfileStepSchema) dto: ProfileStepDto) {
    return this.svc.preview(ctx.tenantId, tenantActorOf(ctx), dto).then((j) => ({ data: {
      writable: j.writable, step: j.step, errors: j.errors, verdicts: j.verdicts, diff: j.diff, advisory: j.advisory,
      displayNameLocked: j.displayNameLocked, reasonRequired: j.reasonRequired,
    } }));
  }

  @Post('profile')
  save(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(ProfileStepSchema) dto: ProfileStepDto) {
    return this.svc.saveProfile(ctx.tenantId, tenantActorOf(ctx), needKey(key), dto, r.ip || null).then((data) => ({ data }));
  }
}
