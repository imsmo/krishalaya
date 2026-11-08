// modules/dairy/controllers/v1/dairy-counter.controller.ts · W167's HTTP surface (PC-56 TENANT-6a).
// One GET, no writes: this board reports and decides nothing. The canon's dairy MUTATE chain (W2559–W2561) is a
// "Retry" of a read — a page load — so no route is invented for it; that refusal is now this programme's fifth, for
// the same reason each time: a route that records an act nobody performed is a lie in an audit trail.
//
// [PC-56 OPS-3p · founder Q6-A, 2026-11-08] THE COMPROMISE TENANT-6a RECORDED HERE IS RETIRED. It read: a dairy secretary
// who should only LOOK needs the scope that can also price milk, because 0004 defined one dairy permission. Migration 0235
// adds `dairy.read` (the boards) and `dairy.collect` (the counter), both seeded in 0004 and granted to tenant_admin, and
// the dairy desk template carries them instead of `dairy.manage`. This board admits any of the three (DAIRY_READ_ANY).
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequireAnyPermission } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { DAIRY_READ_ANY } from '../../policies/dairy.policies';
import { DairyCounterReadModel } from '../../read-models/dairy-counter.read-model';
import { QueryCounterSchema, QueryCounterDto } from '../../dto/query-counter.dto';

@Controller({ path: 'dairy/counter', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
// The module gate AND the screen gate — see the note in bmc.controller.ts (TENANT-6d-2).
@FeatureFlag('dairy', 'dairy_counter_board')
export class DairyCounterController {
  constructor(private readonly board: DairyCounterReadModel) {}

  /** W167: the day's shift board — every centre, its litres, its quality, its analyzer, its cooler, and the money
   *  the pours have accrued so far in the window the members' own preference implies. */
  @Get('board') @RequireAnyPermission(...DAIRY_READ_ANY)
  get(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryCounterSchema) q: QueryCounterDto) {
    return this.board.board(ctx.tenantId, { day: q.day ?? null, shift: q.shift, cycle: q.cycle ?? null })
      .then((data) => ({ data }));
  }
}
