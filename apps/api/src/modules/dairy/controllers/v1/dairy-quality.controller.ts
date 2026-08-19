// modules/dairy/controllers/v1/dairy-quality.controller.ts · W168's HTTP surface (PC-56 TENANT-6b-2).
//
// ONE GET, no writes. The desk's writes are TENANT-6b-1's (`dairy/quality-reviews/:id/retest` and `/decide`), and they
// are deliberately NOT behind this screen's flag: a farmer's withheld pour must not stay withheld because nobody
// switched a screen on. So `dairy_quality_desk` gates the view and nothing else.
//
// The scope compromise, third time this programme has recorded it, and W168 makes it sharpest: the canon's restricted
// state names THREE authorities — *"Flag decisions need dairy-desk scope + committee membership for repeat cases; rate
// cards are owner + checker"* — and `db/seeds/core/0004_roles_permissions.sql` defines exactly ONE dairy permission,
// `dairy.manage`. So a dairy secretary who should only LOOK at the quality of this cycle's milk needs the scope that can
// also price it, and the view says so rather than pretending the other two exist.
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { DairyPermissions } from '../../policies/dairy.policies';
import { DairyQualityReadModel } from '../../read-models/dairy-quality.read-model';
import { QueryQualityDeskSchema, QueryQualityDeskDto } from '../../dto/query-quality-desk.dto';
import { PaymentCycle } from '../../domain/dairy.events';

@Controller({ path: 'dairy/quality', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('dairy_quality_desk')
export class DairyQualityController {
  constructor(private readonly desk: DairyQualityReadModel) {}

  /** W168: the cycle's quality and its stability, the flags and what is held, the premium band and whether it is
   *  actually being paid, every rate card in force, and the arithmetic a farmer is promised. */
  @Get() @RequirePermissions(DairyPermissions.Manage)
  get(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryQualityDeskSchema) q: QueryQualityDeskDto) {
    return this.desk.view(ctx.tenantId, { day: q.day ?? null, cycle: (q.cycle as PaymentCycle | undefined) ?? null })
      .then((data) => ({ data }));
  }
}
