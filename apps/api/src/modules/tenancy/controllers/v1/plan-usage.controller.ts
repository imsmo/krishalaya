// modules/tenancy/controllers/v1/plan-usage.controller.ts · W118's meters and W115's plan cards
// (PC-56 TENANT-4d-1). Read-only. W118: "Plan & usage is visible to tenant_admin and owner; staff see
// feature availability only" — so the meters need `tenant.settings`, the same key the rest of the
// organisation surface uses, while the PLAN CARDS are public by nature (W115 is an onboarding step, before
// anybody has a role at all).
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { PlanUsageService } from '../../services/plan-usage.service';

@Controller({ path: 'plan-usage', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
export class PlanUsageController {
  constructor(private readonly usage: PlanUsageService) {}

  /** W118 whole: the plan (with the version it is price-locked to), the four meters with an honest state
   *  each, the notice threshold actually in force, the projection, and the metrics that are gated but
   *  unpriced. */
  @Get() @RequirePermissions('tenant.settings')
  overview(@CurrentContext() ctx: RequestContext) {
    return this.usage.overview(ctx.tenantId).then((data) => ({ data }));
  }

  /** The member-seat pre-check, so a roster screen can withhold "Add member" rather than let it fail. */
  @Get('member-seat') @RequirePermissions('tenant.settings')
  memberSeat(@CurrentContext() ctx: RequestContext) {
    return this.usage.memberSeatState(ctx.tenantId).then((data) => ({ data }));
  }

  /** W115's cards. Public plans for a country — the newest version of each code, because a price change is
   *  a new version and an old tenant keeps the row they signed. */
  @Get('plans') @RequirePermissions('tenant.settings')
  plans(@CurrentContext() ctx: RequestContext, @Query('country') country?: string) {
    return this.usage.choosablePlans(country || 'IN').then((data) => ({ data }));
  }
}
