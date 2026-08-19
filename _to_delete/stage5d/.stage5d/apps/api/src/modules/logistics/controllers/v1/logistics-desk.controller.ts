// modules/logistics/controllers/v1/logistics-desk.controller.ts · W225's overview and W244's insights over HTTP
// (validate → authorize → delegate, no logic). PC-56 TENANT-5d.
//
// Two GETs, no writes: this desk decides nothing, it reports. The mutate chain the canon attaches to this module
// (W2387–W2389) is a RETRY of a read — "Sharing actions on this module: Retry" — and a retry of a read is a page
// load, so no route is invented for it. That refusal has now been made four times in this programme, for the same
// reason each time: a route that records an act nobody performed is a lie in an audit trail.
//
// Gated by `logistics_desk_insights` (Law 10, OFF). `@ReadOnly` because both reads tolerate replica lag: a desk
// number a few seconds behind is correct enough for a decision about next quarter's routes, and Law 12 says reads go
// to the replica so the write path survives overload.
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { ShipmentPermissions } from '../../policies/logistics.policies';
import { LogisticsDeskReadModel } from '../../read-models/logistics-desk.read-model';
import { QueryInsightsSchema, QueryInsightsDto } from '../../dto/query-insights.dto';

@Controller({ path: 'logistics/desk', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('logistics_desk_insights')
export class LogisticsDeskController {
  constructor(private readonly desk: LogisticsDeskReadModel) {}

  /**
   * W225.
   *
   * **Guarded by `logistics.manage`, and that is a compromise this wave records rather than papers over.** W225's
   * restricted state reads "Needs logistics-desk scope; COD reconciliation adds finance scope", which implies a
   * READ-ONLY logistics scope — and `db/seeds/core/0004_roles_permissions.sql` defines exactly one logistics
   * permission, `logistics.manage`. Inventing `logistics.read` here would create a permission no role grants and no
   * seed defines: every reader would get a 403 from a screen that looks built, which is the same defect shape as a
   * table with no writer. So the desk uses the scope that exists, and the consequence is stated: an FPO chairperson
   * who should be able to LOOK at this screen must currently hold the scope that can also dispatch. Splitting it is
   * an RBAC decision (a seeded permission, a role grant, and a migration of existing grants), not a line an
   * analytics wave may add.
   */
  @Get('overview') @RequirePermissions(ShipmentPermissions.Manage)
  overview(@CurrentContext() ctx: RequestContext) {
    return this.desk.overview(ctx.tenantId).then((data) => ({ data }));
  }

  /** W244. The window is validated against a closed set — an arbitrary day count would let a caller ask a question
   *  the indexes and the partition pruning cannot serve. */
  @Get('insights') @RequirePermissions(ShipmentPermissions.Manage)
  insights(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryInsightsSchema) q: QueryInsightsDto) {
    return this.desk.insights(ctx.tenantId, q.window).then((data) => ({ data }));
  }
}
