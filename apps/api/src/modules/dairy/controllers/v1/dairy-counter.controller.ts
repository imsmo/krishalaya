// modules/dairy/controllers/v1/dairy-counter.controller.ts · W167's HTTP surface (PC-56 TENANT-6a).
// One GET, no writes: this board reports and decides nothing. The canon's dairy MUTATE chain (W2559–W2561) is a
// "Retry" of a read — a page load — so no route is invented for it; that refusal is now this programme's fifth, for
// the same reason each time: a route that records an act nobody performed is a lie in an audit trail.
//
// Guarded by `dairy.manage`, and the compromise is recorded: W167's restricted state reads "Collection data needs
// dairy-desk scope; rate-card changes are owner + checker (member money)" — implying a READ-ONLY dairy scope — and
// `db/seeds/core/0004_roles_permissions.sql` defines exactly one dairy permission, `dairy.manage`. Inventing
// `dairy.read` would create a permission no role grants and no seed defines: every reader would get a 403 from a
// screen that looks built. So the desk uses the scope that exists (the same call TENANT-5d made for logistics), and
// the consequence is stated: a dairy secretary who should only LOOK currently needs the scope that can also price milk.
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { DairyPermissions } from '../../policies/dairy.policies';
import { DairyCounterReadModel } from '../../read-models/dairy-counter.read-model';
import { QueryCounterSchema, QueryCounterDto } from '../../dto/query-counter.dto';

@Controller({ path: 'dairy/counter', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('dairy_counter_board')
export class DairyCounterController {
  constructor(private readonly board: DairyCounterReadModel) {}

  /** W167: the day's shift board — every centre, its litres, its quality, its analyzer, its cooler, and the money
   *  the pours have accrued so far in the window the members' own preference implies. */
  @Get('board') @RequirePermissions(DairyPermissions.Manage)
  get(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryCounterSchema) q: QueryCounterDto) {
    return this.board.board(ctx.tenantId, { day: q.day ?? null, shift: q.shift, cycle: q.cycle ?? null })
      .then((data) => ({ data }));
  }
}
