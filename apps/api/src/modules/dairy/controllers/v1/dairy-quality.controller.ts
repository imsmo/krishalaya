// modules/dairy/controllers/v1/dairy-quality.controller.ts · W168's HTTP surface (PC-56 TENANT-6b-2).
//
// ONE GET, no writes. The desk's writes are TENANT-6b-1's (`dairy/quality-reviews/:id/retest` and `/decide`), and they
// are deliberately NOT behind this screen's flag: a farmer's withheld pour must not stay withheld because nobody
// switched a screen on. So `dairy_quality_desk` gates the view and nothing else.
//
// [PC-56 OPS-3p · founder Q6-A, 2026-11-08] The scope compromise TENANT-6b-2 recorded here (a secretary who should only
// LOOK at quality needed the scope that can also price milk, because 0004 defined one dairy permission) is RETIRED: this
// read admits dairy.read, dairy.collect or dairy.manage (DAIRY_READ_ANY, migration 0235). Every quality DECISION — retest
// and decide, including rejecting a flagged pour, which withholds her pay — stays dairy.manage (quality-reviews.controller).
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequireAnyPermission } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { DAIRY_READ_ANY } from '../../policies/dairy.policies';
import { DairyQualityReadModel } from '../../read-models/dairy-quality.read-model';
import { QueryQualityDeskSchema, QueryQualityDeskDto } from '../../dto/query-quality-desk.dto';
import { PaymentCycle } from '../../domain/dairy.events';

@Controller({ path: 'dairy/quality', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
// The module gate AND the screen gate — see the note in bmc.controller.ts (TENANT-6d-2).
@FeatureFlag('dairy', 'dairy_quality_desk')
export class DairyQualityController {
  constructor(private readonly desk: DairyQualityReadModel) {}

  /** W168: the cycle's quality and its stability, the flags and what is held, the premium band and whether it is
   *  actually being paid, every rate card in force, and the arithmetic a farmer is promised. */
  @Get() @RequireAnyPermission(...DAIRY_READ_ANY)
  get(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryQualityDeskSchema) q: QueryQualityDeskDto) {
    return this.desk.view(ctx.tenantId, { day: q.day ?? null, cycle: (q.cycle as PaymentCycle | undefined) ?? null })
      .then((data) => ({ data }));
  }
}
