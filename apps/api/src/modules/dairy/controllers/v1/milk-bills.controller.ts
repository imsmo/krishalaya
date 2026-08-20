// modules/dairy/controllers/v1/milk-bills.controller.ts · per-cycle milk settlement + wallet payout.
// generate/preview/approve/pay need dairy.manage; reads are the member's own or staff. pay is the money
// route (Idempotency-Key required, Law 3). `dairy` flag.
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { MilkBillService } from '../../services/milk-bill.service';
import { MilkBillDisputeService } from '../../services/milk-bill-dispute.service';
import { RaiseDisputeSchema, RaiseDisputeDto, VoidBillSchema, VoidBillDto } from '../../dto/milk-bill-dispute.dto';
import { GenerateBillSchema, GenerateBillDto } from '../../dto/create-milk-bill.dto';
import { QueryBillsSchema, QueryBillsDto } from '../../dto/query-milk-bill.dto';
import { DairyPermissions, canManageDairy } from '../../policies/dairy.policies';

const ipOf = (r: Request) => r.ip || null;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'dairy/milk-bills', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('dairy')
export class MilkBillsController {
  constructor(private readonly bills: MilkBillService, private readonly disputes: MilkBillDisputeService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageDairy(ctx) }; }

  @Post('generate') @RequirePermissions(DairyPermissions.Manage)
  generate(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(GenerateBillSchema) dto: GenerateBillDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.bills.generate(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryBillsSchema) q: QueryBillsDto) {
    return this.bills.list(ctx.tenantId, this.actor(ctx), { box: q.box, membershipId: q.membershipId, status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.bills.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  @Post(':id/preview') @RequirePermissions(DairyPermissions.Manage)
  preview(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.bills.preview(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  @Post(':id/approve') @RequirePermissions(DairyPermissions.Manage)
  approve(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.bills.approve(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  /**
   * [PC-56 TENANT-6c-2] **THE MEMBER'S OWN ROUTE — AND THE ONLY DAIRY ROUTE WITH NO PERMISSION ON IT.**
   *
   * W169 gives the member 24 hours to object. Authorisation here is OWNERSHIP, checked in the service: the caller must
   * be the farmer on the bill's membership, and a mismatch returns 404 rather than 403 so bill ids cannot be probed.
   * `@RequirePermissions` is deliberately ABSENT: requiring `dairy.manage` would mean the only people who could object
   * to a bill are the people who wrote it.
   */
  @Post(':id/dispute')
  raiseDispute(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string,
               @Headers('idempotency-key') key: string, @ZodBody(RaiseDisputeSchema) dto: RaiseDisputeDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.disputes.raise(ctx.tenantId, ctx.userId, id, dto.reason, key, ipOf(r)).then((data) => ({ data }));
  }

  /** One bill's dispute history — the member's own, or staff's. */
  @Get(':id/disputes')
  listDisputes(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.disputes.listForBill(ctx.tenantId, this.actor(ctx), id, 50).then((data) => ({ data }));
  }

  /**
   * Void a bill and release its pours so a correct one can be built — the only correction this platform can make to a
   * milk bill's arithmetic (there is no adjustment line and no credit note on `milk_bills`). Staff, with a reason.
   */
  @Post(':id/void') @RequirePermissions(DairyPermissions.Manage)
  voidBill(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(VoidBillSchema) dto: VoidBillDto) {
    return this.bills.voidBill(ctx.tenantId, this.actor(ctx), id, dto.reason, ipOf(r)).then((data) => ({ data }));
  }

  @Post(':id/pay') @RequirePermissions(DairyPermissions.Manage)
  pay(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.bills.pay(ctx.tenantId, this.actor(ctx), id, key, ipOf(r)).then((data) => ({ data }));
  }
}
