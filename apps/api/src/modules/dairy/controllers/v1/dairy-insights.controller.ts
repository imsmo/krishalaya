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
import { Controller, Get, Headers, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { ExportPlaneService } from '../../../../core/exports-plane/export-plane.service';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { DAIRY_INSIGHTS_DATASET, DairyInsightsExportParamsSchema, DairyInsightsExportParams } from '../../exports/dairy-insights.dataset';
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
  constructor(private readonly insights: DairyInsightsReadModel, private readonly exportsPlane: ExportPlaneService) {}

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

  /**
   * [PC-56 TENANT-6e-2] W172's **Export** button → W2553. ENQUEUES a job on the tenant export plane and returns it with
   * its position and ETA; the page redirects to the job and polls there. Gated exactly as the page is: `dairy.manage`
   * here, the module flag on the class, and the screen's own `dairy_insights` flag inside the PRODUCER — a job whose
   * screen is switched off fails with `dataset_disabled` and says so on the receipt. The plane's own flag
   * (`tenant_exports`) is read in the service and answers 404 with a code the page can name.
   *
   * Idempotency-Key required (Law 3). The same window asked twice while the first job is open returns the first job.
   */
  @Post('export') @RequirePermissions(DairyPermissions.Manage)
  enqueueExport(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @ZodBody(DairyInsightsExportParamsSchema) body: DairyInsightsExportParams) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.exportsPlane
      .enqueue(ctx.tenantId, { userId: ctx.userId, permissions: ctx.permissions }, key, { datasetCode: DAIRY_INSIGHTS_DATASET, params: body }, req.ip || null)
      .then((data) => ({ data }));
  }
}
