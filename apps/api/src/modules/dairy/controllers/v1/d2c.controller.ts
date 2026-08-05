// modules/dairy/controllers/v1/d2c.controller.ts · PC-54 W54-5. D2C plans/subscriptions + the MCC day sheet.
import { Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { DairyPermissions, canManageDairy } from '../../policies/dairy.policies';
import { D2cService } from '../../services/d2c.service';
import { z } from 'zod';

const minorStr = z.string().regex(/^\d{1,15}$/);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const CreatePlanSchema = z.object({
  productId: z.string().uuid(), defaultName: z.string().trim().min(2).max(150),
  frequency: z.enum(['daily', 'alternate_day', 'weekly', 'monthly']),
  qtyPerDelivery: z.string().regex(/^\d{1,5}(\.\d{1,3})?$/), unitCode: z.string().min(1).max(20),
  pricePerDeliveryMinor: minorStr, deliveryWindow: z.string().max(40).optional(),
}).strict();
const SubscribeSchema = z.object({ planId: z.string().uuid(), addressId: z.string().uuid(), startsOn: dateStr }).strict();
const PauseSchema = z.object({ pausedUntil: dateStr }).strict();

@Controller({ path: 'dairy/d2c', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('dairy')
export class D2cController {
  constructor(private readonly svc: D2cService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageDairy(ctx) }; }

  @Post('plans') @RequirePermissions(DairyPermissions.Manage)
  createPlan(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(CreatePlanSchema) dto: z.infer<typeof CreatePlanSchema>) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.createPlan(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }
  @Get('plans')
  plans(@CurrentContext() ctx: RequestContext) { return this.svc.listPlans(ctx.tenantId).then((data) => ({ data })); }

  @Post('subscriptions')
  subscribe(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(SubscribeSchema) dto: z.infer<typeof SubscribeSchema>) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.subscribe(ctx.tenantId, ctx.userId, key, dto).then((data) => ({ data }));
  }
  @Get('subscriptions/mine')
  mine(@CurrentContext() ctx: RequestContext) { return this.svc.mine(ctx.tenantId, ctx.userId).then((data) => ({ data })); }
  @Post('subscriptions/:id/pause')
  pause(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(PauseSchema) dto: { pausedUntil: string }) {
    return this.svc.setStatus(ctx.tenantId, ctx.userId, id, 'paused', dto.pausedUntil).then((data) => ({ data }));
  }
  @Post('subscriptions/:id/resume')
  resume(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.setStatus(ctx.tenantId, ctx.userId, id, 'active').then((data) => ({ data })); }
  @Post('subscriptions/:id/cancel')
  cancel(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.setStatus(ctx.tenantId, ctx.userId, id, 'cancelled').then((data) => ({ data })); }

  /** PC-54 W54-5 `mcc-shift-summary` (canon 238): GET dairy/d2c/../day sheet lives on the MCC path below. */
  @Get('mccs/:mccId/day-summary') @RequirePermissions(DairyPermissions.Manage)
  daySummary(@CurrentContext() ctx: RequestContext, @Param('mccId') mccId: string, @Query('date') date?: string) {
    return this.svc.shiftSummary(ctx.tenantId, this.actor(ctx), mccId, date ?? new Date().toISOString().slice(0, 10)).then((data) => ({ data }));
  }
}
