// modules/ambassadors/controllers/v1/ambassadors.controller.ts · ambassador profiles + commission plans.
// enroll/update/suspend + payout need ambassador.manage; `me` is the caller's own profile. `ambassadors` flag.
import { Controller, Get, Headers, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import type { Request } from 'express';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { AmbassadorProfileService } from '../../services/ambassador-profile.service';
import { CommissionPlanService } from '../../services/commission-plan.service';
import { AmbassadorEarningService } from '../../services/ambassador-earning.service';
import { AmbassadorsPermissions, canManageAmbassadors } from '../../policies/ambassadors.policies';
import { EnrollAmbassadorSchema, EnrollAmbassadorDto, UpdateAmbassadorSchema, UpdateAmbassadorDto } from '../../dto/enroll-ambassador.dto';
import { QueryAmbassadorsSchema, QueryAmbassadorsDto } from '../../dto/query-ambassador.dto';
import { QueryEarningsSchema, QueryEarningsDto } from '../../dto/query-earning.dto';

// HOTFIX-1 (8c's F-7 class): the audit row's `ip` is an inet — the client's address (`req.ip`, behind main.ts's
// `trust proxy` hops) or NULL, never `ctx.requestId` (a UUID, which made every one of these writes a 22P02 and rolled back).
export const ipOf = (r: Pick<Request, 'ip'>): string | null => (typeof r.ip === 'string' && r.ip.length > 0 ? r.ip : null);
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'ambassadors', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('ambassadors')
export class AmbassadorsController {
  constructor(private readonly profiles: AmbassadorProfileService, private readonly plans: CommissionPlanService, private readonly earnings: AmbassadorEarningService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageAmbassadors(ctx) }; }

  @Post() @RequirePermissions(AmbassadorsPermissions.Manage)
  enroll(@CurrentContext() ctx: RequestContext, @Req() r: Request, @ZodBody(EnrollAmbassadorSchema) dto: EnrollAmbassadorDto) { return this.profiles.enroll(ctx.tenantId, this.actor(ctx), dto, ipOf(r)).then((data) => ({ data })); }
  @Get() @RequirePermissions(AmbassadorsPermissions.Manage)
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryAmbassadorsSchema) q: QueryAmbassadorsDto) {
    return this.profiles.list(ctx.tenantId, this.actor(ctx), { activeOnly: q.activeOnly, cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get('me')
  mine(@CurrentContext() ctx: RequestContext) { return this.profiles.getMine(ctx.tenantId, this.actor(ctx)).then((data) => ({ data })); }
  @Get('plans')
  plansList(@CurrentContext() ctx: RequestContext) { return this.plans.list(ctx.tenantId).then((data) => ({ data })); }
  @Get(':id') @RequirePermissions(AmbassadorsPermissions.Manage)
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.profiles.getById(ctx.tenantId, id).then((data) => ({ data })); }
  @Patch(':id') @RequirePermissions(AmbassadorsPermissions.Manage)
  update(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(UpdateAmbassadorSchema) dto: UpdateAmbassadorDto) { return this.profiles.update(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data })); }
  @Post(':id/suspend') @RequirePermissions(AmbassadorsPermissions.Manage)
  suspend(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) { return this.profiles.setActive(ctx.tenantId, this.actor(ctx), id, false, ipOf(r)).then((data) => ({ data })); }
  @Post(':id/reinstate') @RequirePermissions(AmbassadorsPermissions.Manage)
  reinstate(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) { return this.profiles.setActive(ctx.tenantId, this.actor(ctx), id, true, ipOf(r)).then((data) => ({ data })); }

  @Get(':id/earnings') @RequirePermissions(AmbassadorsPermissions.Manage)
  earningsList(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodQuery(QueryEarningsSchema) q: QueryEarningsDto) {
    return this.earnings.listForAmbassador(ctx.tenantId, id, { unpaidOnly: q.unpaidOnly, cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Post(':id/payout') @RequirePermissions(AmbassadorsPermissions.Manage)
  payout(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.earnings.payoutAmbassador(ctx.tenantId, id, `ambpayout:${id}:${key}`).then((data) => ({ data }));
  }
}
