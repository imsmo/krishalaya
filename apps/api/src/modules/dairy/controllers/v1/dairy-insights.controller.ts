// modules/dairy/controllers/v1/dairy-insights.controller.ts · W172 (Dairy insights) — PC-56 TENANT-6e-1.
//
// One route, one GET, no acts. Every read behind it goes through `READ_REPLICA` (in the repository, where the platform
// routes replica traffic — Law 12) because this page tolerates lag by construction: a pour recorded four seconds ago
// cannot perceptibly move a 90-day average, and sending it to the primary would put a cooperative's analytics page on
// the same connection as its counter.
//
// **ONLY THE MODULE FLAG IS ON THE ROUTE.** `FeatureFlagGuard` answers a disabled flag with 404, so a route carrying
// `dairy_insights` could never reach W172's flagged-off STATE — the page would get a 404 indistinguishable from a
// mistyped URL, where the canon wants words ("insights are not switched on"). So `dairy` gates the route, the screen's
// own flag is read inside the read model, and 0168.5 says the same thing from the database's side.
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { DairyInsightsReadModel } from '../../read-models/dairy-insights.read-model';
import { QueryDairyInsightsSchema, QueryDairyInsightsDto } from '../../dto/query-dairy-insights.dto';
import { DairyPermissions, canDrillDownMember } from '../../policies/dairy.policies';

@Controller({ path: 'dairy/insights', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('dairy')
export class DairyInsightsController {
  constructor(private readonly insights: DairyInsightsReadModel) {}

  /**
   * W172. The window is validated against the domain's closed set, because an arbitrary day count is a request able to
   * read a cooperative's whole history in one page load (see the DTO).
   *
   * `dairy.manage` guards the page and `member.view360` is resolved BESIDE it rather than instead of it — the drill-down
   * is a second decision (0128), and it is resolved here for every request even though only the page footer reads it,
   * because a controller that resolves the subset it happens to need today is the shape of the next authorisation bug
   * (6d-6's rule, restated).
   */
  @Get() @RequirePermissions(DairyPermissions.Manage)
  view(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryDairyInsightsSchema) q: QueryDairyInsightsDto) {
    return this.insights
      .view(ctx.tenantId, { userId: ctx.userId, canDrillDown: canDrillDownMember(ctx) }, { window: q.window })
      .then((data) => ({ data }));
  }
}
