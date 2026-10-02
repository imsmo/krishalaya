// modules/ambassadors/controllers/v1/earnings.controller.ts · the caller's OWN ambassador earnings.
// Resolves the caller's ambassador profile server-side (no client id → no IDOR). `ambassadors` flag.
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { AmbassadorProfileService } from '../../services/ambassador-profile.service';
import { AmbassadorEarningService } from '../../services/ambassador-earning.service';
import { canManageAmbassadors } from '../../policies/ambassadors.policies';
import { QueryEarningsSchema, QueryEarningsDto } from '../../dto/query-earning.dto';
import { decodeCursor } from '../../domain/cursor';


@Controller({ path: 'ambassadors/me/earnings', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('ambassadors')
export class EarningsController {
  constructor(private readonly profiles: AmbassadorProfileService, private readonly earnings: AmbassadorEarningService) {}

  @Get()
  async mine(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryEarningsSchema) q: QueryEarningsDto) {
    const me = await this.profiles.getMine(ctx.tenantId, { userId: ctx.userId, canManage: canManageAmbassadors(ctx) });
    const res = await this.earnings.listForAmbassador(ctx.tenantId, (me as any).id, { unpaidOnly: q.unpaidOnly, cursor: decodeCursor(q.cursor), limit: q.limit });
    return { data: res.items, meta: { nextCursor: res.nextCursor } };
  }
}
