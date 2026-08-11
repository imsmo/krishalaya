// modules/tenancy/controllers/v1/subscriptions.controller.ts · a tenant's subscription (the quota
// foundation). subscribe/change/cancel are enforced in the service (tenant.settings or plan.manage);
// GET /current + GET / are tenant-scoped reads. Gated by the `tenancy` feature flag.
import { Controller, Delete, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { SubscriptionService } from '../../services/subscription.service';
import { PlanChangeService } from '../../services/plan-change.service';
import { PlanCompareReadModel } from '../../read-models/plan-compare.read-model';
import { SubscribeSchema, SubscribeDto, ChangePlanSchema, ChangePlanDto, CancelSubscriptionSchema, CancelSubscriptionDto } from '../../dto/create-subscription.dto';
import { QuerySubscriptionsSchema, QuerySubscriptionsDto } from '../../dto/query-subscription.dto';
import { actorOf } from '../../policies/tenancy.policies';

const ipOf = (r: Request) => r.ip || null;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'subscriptions', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('tenancy')
export class SubscriptionsController {
  constructor(
    private readonly subscriptions: SubscriptionService,
    private readonly planChange: PlanChangeService,
    private readonly compare: PlanCompareReadModel,
  ) {}

  @Post()
  subscribe(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(SubscribeSchema) dto: SubscribeDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.subscriptions.subscribe(ctx.tenantId, actorOf(ctx), key, dto).then((data) => ({ data }));
  }

  @Get('current')
  current(@CurrentContext() ctx: RequestContext) { return this.subscriptions.getCurrent(ctx.tenantId).then((data) => ({ data })); }

  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QuerySubscriptionsSchema) q: QuerySubscriptionsDto) {
    return this.subscriptions.list(ctx.tenantId, actorOf(ctx), { box: q.box, status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  /** W119's compare table, the tenant's current plan, live usage, and anything already scheduled. Read-only. */
  @Get('plans/compare')
  comparePlans(@CurrentContext() ctx: RequestContext) {
    return this.compare.view(ctx.tenantId).then((data) => ({ data }));
  }

  /**
   * What a change to this plan would cost, and what it would break. **WRITES NOTHING AND CHARGES NOTHING.**
   *
   * W119: "Couldn't compute proration · No charge was made — proration always previews before any payment." That sentence
   * is only true if previewing is its own act, which is why this is a GET.
   */
  @Get(':id/plan-preview')
  planPreview(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Query('planId') planId: string) {
    if (!planId) throw new BadRequestError('planId required');
    return this.planChange.preview(ctx.tenantId, actorOf(ctx), id, planId).then((data) => ({ data }));
  }

  /**
   * Change plan — an upgrade now and invoiced, a downgrade scheduled for the period end.
   *
   * **REWIRED IN PC-56 TENANT-1d-2.** This route used to call `SubscriptionService.changePlan`, which swapped the plan id
   * and the price, wrote one audit line and billed nothing at all — so every upgrade the platform ever processed was free,
   * and every downgrade applied the same second (losing the tenant capability they had already paid for). The proration
   * arithmetic and 0126's tables existed; no call site did.
   */
  @Post(':id/change-plan')
  changePlan(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(ChangePlanSchema) dto: ChangePlanDto) {
    return this.planChange.change(ctx.tenantId, actorOf(ctx), id, dto.planId, { reason: dto.reason, ip: ipOf(r) })
      .then((data) => ({ data }));
  }

  /** The plan-change history — where the chain's "View audit trail" points, with every component of each computation. */
  @Get(':id/plan-changes')
  planChanges(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.planChange.history(ctx.tenantId, actorOf(ctx), id).then((data) => ({ data }));
  }

  /** Cancel a scheduled downgrade before it applies. Not on W119 — reasoned in the service. */
  @Delete(':id/pending-change')
  cancelPending(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) {
    return this.planChange.cancelPending(ctx.tenantId, actorOf(ctx), id, ipOf(r)).then((data) => ({ data }));
  }

  @Post(':id/cancel')
  cancel(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(CancelSubscriptionSchema) dto: CancelSubscriptionDto) {
    return this.subscriptions.cancel(ctx.tenantId, actorOf(ctx), id, dto.atPeriodEnd, ipOf(r)).then((data) => ({ data }));
  }
}
