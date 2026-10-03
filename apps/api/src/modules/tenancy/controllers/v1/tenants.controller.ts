// modules/tenancy/controllers/v1/tenants.controller.ts · the tenant self-serve surface (validate→authorize→
// delegate). Everything is scoped to the CALLER'S tenant (ctx.tenantId) — there is no :tenantId path param, so a
// tenant can only ever read/edit itself (no cross-tenant enumeration). Profile/domain writes need tenant.settings.
// Gated by the `tenancy` feature flag. Creates require an Idempotency-Key.
import { Controller, Get, Headers, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { TenancyPermissions, tenantActorOf } from '../../policies/tenancy.policies';
import { TenantService } from '../../services/tenant.service';
import { UpdateTenantProfileSchema, UpdateTenantProfileDto } from '../../dto/update-tenant.dto';

const ipOf = (r: Request) => r.ip || null;
const reqKey = (k: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };

@Controller({ path: 'tenants', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('tenancy')
export class TenantsController {
  constructor(private readonly tenants: TenantService) {}

  @Get('me')
  me(@CurrentContext() ctx: RequestContext) { return this.tenants.getMine(ctx.tenantId).then((data) => ({ data })); }

  @Patch('me') @RequirePermissions(TenancyPermissions.ManageTenant)
  update(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(UpdateTenantProfileSchema) dto: UpdateTenantProfileDto) {
    return this.tenants.updateProfile(ctx.tenantId, tenantActorOf(ctx), reqKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }

  /**
   * PC-56 TENANT-4d-3 · W2424's field list: the tax/registration identifiers THIS TENANT'S COUNTRY defines
   * (0147), with i18n label keys, examples, and whether a check digit will actually be verified. A tenant
   * outside India gets its own country's fields — or an empty list, which the screen states rather than
   * falling back to India's.
   *
   * Flag-gated separately from the rest of this controller: reading the tenant profile is old behaviour, the
   * tax-identity FORM is new. Hence the guard here rather than on the class.
   */
  @Get('me/tax-identity') @RequirePermissions(TenancyPermissions.ManageTenant) @FeatureFlag('tenant_tax_identity_form')
  taxIdentity(@CurrentContext() ctx: RequestContext) {
    return this.tenants.taxIdentityFields(ctx.tenantId, tenantActorOf(ctx)).then((data) => ({ data }));
  }

  /**
   * W2424 + W2425: validate the whole patch and return EVERY error with its reason, plus the diff against
   * current values. **A read that writes nothing** — POST only because a patch body is not a query string.
   * No Idempotency-Key: there is nothing to be idempotent about.
   */
  @Post('me/preview') @RequirePermissions(TenancyPermissions.ManageTenant) @FeatureFlag('tenant_tax_identity_form')
  preview(@CurrentContext() ctx: RequestContext, @ZodBody(UpdateTenantProfileSchema) dto: UpdateTenantProfileDto) {
    return this.tenants.previewProfile(ctx.tenantId, tenantActorOf(ctx), dto).then((data) => ({ data }));
  }

  @Post('me/submit') @RequirePermissions(TenancyPermissions.ManageTenant)
  submit(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string) {
    return this.tenants.submitForReview(ctx.tenantId, tenantActorOf(ctx), reqKey(key), ipOf(r)).then((data) => ({ data }));
  }

  // ---- custom domains: PC-56 TENANT-13d moved them to TenantDomainsController (`/tenants/me/domains`, flag `tenant_domains`, every route
  // tenant.settings — F-12). The one-person `/:id/primary` and the always-failing `DELETE /:id` (F-6) became proposals. ----
}
