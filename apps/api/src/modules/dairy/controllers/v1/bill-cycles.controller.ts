// modules/dairy/controllers/v1/bill-cycles.controller.ts · PC-56 TENANT-6c-2 · W169's cycle routes.
//
// The cycle itself arrived with TENANT-6c-1 and had no surface: the cadence job created and closed rows and nothing
// could read them. This adds the read, and W169's header act.
//
// [PC-56 TENANT-6c-3] APPROVE IS NOW HERE, with the second signature. W169: *"Preview/approve needs dairy-desk +
// `settlement.close` + checker — this is 312 families' milk money."* Both routes carry BOTH keys (the earlier version of
// this file shipped preview behind `dairy.manage` alone), and the approver must not be whoever previewed the cycle —
// enforced on the aggregate and again by a database constraint.
import { Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { DairyBillCycleService } from '../../services/dairy-bill-cycle.service';
import { DairyPermissions, canManageDairy, canCloseSettlement } from '../../policies/dairy.policies';

@Controller({ path: 'dairy/bill-cycles', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('dairy')
export class BillCyclesController {
  constructor(private readonly cycles: DairyBillCycleService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageDairy(ctx), canCloseSettlement: canCloseSettlement(ctx) }; }

  /** This tenant's cycles, newest window first — with each one's bill counts MEASURED from its bills. */
  @Get() @RequirePermissions(DairyPermissions.Manage)
  list(@CurrentContext() ctx: RequestContext, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(Number(limit ?? 20) || 20, 1), 100);
    return this.cycles.list(ctx.tenantId, this.actor(ctx), n).then((data) => ({ data }));
  }

  @Get(':id') @RequirePermissions(DairyPermissions.Manage)
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.cycles.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data }));
  }

  /**
   * W169's header button: *"Preview cycle 01–15 Jul (Wed close)"*.
   *
   * Behind `dairy_cycle_preview` (0158, default OFF) because one press starts 312 clocks and queues 312 messages, and
   * Idempotency-Key'd because it is a bulk act over money records on a 2G network that retries constantly (Law 3). The
   * pass is bounded and RESUMABLE, so the honest response is what it did and what is LEFT — pressing again finishes.
   */
  @Post(':id/preview') @RequirePermissions(DairyPermissions.Manage, DairyPermissions.SettlementClose) @FeatureFlag('dairy_cycle_preview')
  preview(@CurrentContext() ctx: RequestContext, @Req() _r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.cycles.previewCycleIdempotent(ctx.tenantId, this.actor(ctx), id, key).then((data) => ({ data }));
  }

  /**
   * W169's second act: *"approved Thu evening (maker-checker)"*.
   *
   * Two keys AND a different human. Deliberately NOT gated on the members' dispute windows being shut — the canon
   * approves on Thursday evening while the windows run to Friday morning, and that ordering is right: approval is the
   * cooperative agreeing its own figures, and it is the PAYMENT that waits for the member.
   */
  @Post(':id/approve') @RequirePermissions(DairyPermissions.Manage, DairyPermissions.SettlementClose) @FeatureFlag('dairy_cycle_approve')
  approve(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.cycles.approveCycleIdempotent(ctx.tenantId, this.actor(ctx), id, key).then((data) => ({ data }));
  }
}
