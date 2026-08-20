// modules/dairy/controllers/v1/member-credits.controller.ts · PC-56 TENANT-6c-4 · the MCC's credit desk.
//
// W169's first deduction line is *"−₹500 feed credit"*, and until this wave there was no record anywhere of feed sold
// to a member on credit — so the line could recover nothing. These are the routes that write and read that receivable.
//
// Behind its OWN flag (`dairy_member_credit`, 0160, default OFF), separately from the recovery path: switching off the
// desk must not strand a bill whose line is already recorded, and switching off recovery must not stop the MCC writing
// down what it sold.
import { Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { DairyMemberCreditService } from '../../services/dairy-member-credit.service';
import { DairyDeductionTypeRepository } from '../../repositories/dairy-deduction-type.repository';
import { IssueMemberCreditSchema, IssueMemberCreditDto } from '../../dto/member-credit.dto';
import { DairyPermissions, canManageDairy, canCloseSettlement } from '../../policies/dairy.policies';

const ipOf = (r: Request) => r.ip || null;

@Controller({ path: 'dairy/member-credits', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('dairy')
export class MemberCreditsController {
  constructor(
    private readonly credits: DairyMemberCreditService,
    private readonly types: DairyDeductionTypeRepository,
  ) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageDairy(ctx), canCloseSettlement: canCloseSettlement(ctx) }; }

  /**
   * Record feed / mineral mix / medicine sold on credit.
   *
   * `dairy.manage` only, and NOT `settlement.close`: this creates a receivable, it moves no money, and requiring the
   * settlement key would mean a counter operator cannot write down a bag of feed without a tenant admin present.
   * The second key guards the acts that MOVE money (TENANT-6c-3), and the recovery of this credit is one of them.
   */
  @Post() @RequirePermissions(DairyPermissions.Manage) @FeatureFlag('dairy_member_credit')
  issue(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string,
        @ZodBody(IssueMemberCreditSchema) dto: IssueMemberCreditDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.credits.issue(ctx.tenantId, this.actor(ctx), key, dto, ipOf(r)).then((data) => ({ data }));
  }

  /** One member's credits and their total outstanding — what an operator reads BEFORE deducting anything. */
  @Get() @RequirePermissions(DairyPermissions.Manage)
  list(@CurrentContext() ctx: RequestContext, @Query('membershipId') membershipId: string, @Query('limit') limit?: string) {
    if (!membershipId) throw new BadRequestError('membershipId is required');
    const n = Math.min(Math.max(Number(limit ?? 50) || 50, 1), 200);
    return this.credits.listForMember(ctx.tenantId, this.actor(ctx), membershipId, n).then((data) => ({ data }));
  }

  /**
   * The deduction VOCABULARY, with each type's destination and — for the ones that have none — the reason.
   *
   * A picker that offers `insurance` and then fails at payday is the shape this wave exists to remove, so the console
   * is told which types can actually be recovered and why the others cannot, from the same rows the payment path reads.
   */
  @Get('types') @RequirePermissions(DairyPermissions.Manage)
  deductionTypes(@CurrentContext() ctx: RequestContext) {
    return this.types.list(ctx.tenantId).then((data) => ({ data }));
  }

  /** ONE credit with everything ever recovered against it — reconciliation from the destination's side. */
  @Get(':id') @RequirePermissions(DairyPermissions.Manage)
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.credits.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data }));
  }
}
