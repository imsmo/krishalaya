// modules/dairy/controllers/v1/bill-disputes.controller.ts · PC-56 TENANT-6c-2 · the cooperative's side of a dispute.
//
// The member RAISES one on their own bill (POST /dairy/milk-bills/:id/dispute — no permission, ownership-checked). This
// controller is the other half: the queue of what is waiting on the cooperative, and the answer.
//
// NOT behind `dairy_cycle_preview`. That flag gates the act that STARTS 312 clocks; answering a member who has already
// objected must not stop working because a console feature was switched off — the same ruling 0156 made for the
// pour-level hold, and the reason a farmer's money never depends on a screen.
import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { MilkBillDisputeService } from '../../services/milk-bill-dispute.service';
import { ResolveDisputeSchema, ResolveDisputeDto } from '../../dto/milk-bill-dispute.dto';
import { DairyPermissions, canManageDairy, canCloseSettlement } from '../../policies/dairy.policies';

const ipOf = (r: Request) => r.ip || null;

@Controller({ path: 'dairy/bill-disputes', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('dairy')
export class BillDisputesController {
  constructor(private readonly disputes: MilkBillDisputeService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageDairy(ctx), canCloseSettlement: canCloseSettlement(ctx) }; }

  /** What is waiting on the cooperative, oldest first — a dispute is a family waiting for money. */
  @Get() @RequirePermissions(DairyPermissions.Manage)
  listOpen(@CurrentContext() ctx: RequestContext, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(Number(limit ?? 50) || 50, 1), 200);
    return this.disputes.listOpen(ctx.tenantId, this.actor(ctx), n).then((data) => ({ data }));
  }

  /**
   * Answer it. `note` is required at a 10-character floor: W169's tile claims last cycle's disputes were "resolved",
   * and a member told "rejected" with no explanation has been processed rather than answered.
   */
  @Post(':id/resolve') @RequirePermissions(DairyPermissions.Manage)
  resolve(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(ResolveDisputeSchema) dto: ResolveDisputeDto) {
    return this.disputes.resolve(ctx.tenantId, this.actor(ctx), id,
      { outcome: dto.outcome, note: dto.note, voidBill: dto.voidBill }, ipOf(r)).then((data) => ({ data }));
  }
}
