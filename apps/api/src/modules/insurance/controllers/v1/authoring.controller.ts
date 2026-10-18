// modules/insurance/controllers/v1/authoring.controller.ts · PC-54 W54-9 (insurance.manage class-gated) — LOCKED DOWN by PC-56 PARTNER-2a
// (survey F-1, founder Q10: the wave's first commit). Now behind `@FeatureFlag('insurance')` like its three siblings (products / policies /
// claims): `insurance` OFF → every route here answers 404. The three WRITE routes stay so a caller gets a SENTENCE (E6 — a named refusal, not
// a 404): they take no body (a malformed body must not turn the refusal into a 400) and answer 403 by name —
//   POST  products              → INSURANCE_PRODUCT_PLATFORM_AUTHORED (founder Q7: the platform authors products, in the admin realm)
//   PATCH products/:id          → INSURANCE_PRODUCT_PLATFORM_AUTHORED
//   POST  policies/:id/issue    → INSURANCE_ISSUE_NOT_ON_PLATFORM     (founder Q5: no issuance on the platform in Phase 1)
// `GET book` and `GET insights` are TENANT reads of the tenant's own members under tenant RLS (named, survey F-12).
import { Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { InsurancePermissions } from '../../policies/insurance.policies';
import { AuthoringService } from '../../services/authoring.service';

@Controller({ path: 'insurance/authoring', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('insurance')
@RequirePermissions(InsurancePermissions.Manage)
export class AuthoringController {
  constructor(private readonly svc: AuthoringService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: true }; } // class-gated

  /** REFUSED BY NAME (founder Q7). */
  @Post('products')
  create() { return this.svc.createProduct(); }
  /** REFUSED BY NAME (founder Q7). */
  @Patch('products/:id')
  update() { return this.svc.updateProduct(); }
  /** REFUSED BY NAME (founder Q5). */
  @Post('policies/:id/issue')
  issue() { return this.svc.issue(); }

  @Get('book')
  book(@CurrentContext() ctx: RequestContext, @Query('status') status?: string, @Query('limit') limit?: string) {
    return this.svc.book(ctx.tenantId, this.actor(ctx), status, Number(limit) || 100).then((data) => ({ data }));
  }
  @Get('insights')
  insights(@CurrentContext() ctx: RequestContext) { return this.svc.insights(ctx.tenantId, this.actor(ctx)).then((data) => ({ data })); }
}
