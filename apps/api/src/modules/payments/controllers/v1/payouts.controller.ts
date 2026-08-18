// modules/payments/controllers/v1/payouts.controller.ts · withdrawals (money OUT).
// A user requests a payout from THEIR wallet to THEIR bank account (ownership enforced in the
// service). Gated by online_payments. Idempotency-Key required (it moves money).
import { Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { PayoutBatchService } from '../../services/payout-batch.service';
import { PayoutService } from '../../services/payout.service';
import { PayoutApprovalService } from '../../services/payout-approval.service';
import { PayoutConsoleReadModel } from '../../read-models/payout-console.read-model';
import { CreatePayoutSchema, CreatePayoutDto } from '../../dto/create-payout.dto';
import { PreparePayoutBatchSchema, PreparePayoutBatchDto, DecidePayoutBatchSchema, DecidePayoutBatchDto } from '../../dto/payout-approval.dto';
import { canModeratePayment } from '../../policies/payments.policies';

const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'payouts', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('online_payments')
export class PayoutsController {
  constructor(
    private readonly payouts: PayoutService,
    private readonly batches: PayoutBatchService,
    private readonly approvals: PayoutApprovalService,
    private readonly console: PayoutConsoleReadModel,
  ) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canModerate: canModeratePayment(ctx) }; }

  @Post()
  request(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(CreatePayoutSchema) dto: CreatePayoutDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.payouts.requestPayout(ctx.tenantId, ctx.userId, key, dto).then((data) => ({ data }));
  }

  @Get()
  list(@CurrentContext() ctx: RequestContext, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return this.payouts.list(ctx.tenantId, ctx.userId, { cursor: decodeCursor(cursor), limit: lim }, ctx.lang).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  /* --- W145: THE ORGANISATION's outbound queue (PC-56 TENANT-4b). Distinct from GET / above, which is the
     caller's OWN withdrawal history — that difference is the defect this wave fixed on the screen. --- */
  @Get('console') @RequirePermissions('payout.approve')
  consoleQueue(@CurrentContext() ctx: RequestContext, @Query('tab') tab?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
    return this.console.queue(ctx.tenantId, { tab, cursor: decodeCursor(cursor), limit: lim }).then((data) => ({ data }));
  }

  // --- payout-batch reads. TENANT-SCOPED SINCE TENANT-4b: both used to take no tenant at all. ---
  @Get('batches') @RequirePermissions('payout.approve')
  listBatches(@CurrentContext() ctx: RequestContext, @Query('status') status?: string, @Query('batchType') batchType?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return this.batches.list({ tenantId: ctx.tenantId, status: status as never, batchType, cursor, limit: lim }).then((data) => ({ data }));
  }
  @Get('batches/:id') @RequirePermissions('payout.approve')
  async getBatch(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    const data = await this.batches.getById(ctx.tenantId, id);
    if (!data) throw new BadRequestError('batch not found');
    return { data };
  }

  /** W146 whole: the batch, its contents, its pre-flight evidence and what stands between it and 18:00. */
  @Get('batches/:id/review') @RequirePermissions('payout.approve')
  review(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.console.batchReview(ctx.tenantId, ctx.userId, id).then((data) => ({ data }));
  }

  /** W146's maker step. Needs `payout.prepare` (0143) — preparing a run is not approving one. */
  @Post('batches') @RequirePermissions('payout.prepare')
  prepare(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(PreparePayoutBatchSchema) dto: PreparePayoutBatchDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.approvals.prepare(ctx.tenantId, ctx.userId, { batchType: dto.batchType, executeAt: new Date(dto.executeAt), maxPriority: dto.maxPriority ?? null })
      .then((data) => ({ data }));
  }

  /** W146's checker step: "Approve — execute at 18:00" / "Reject with reason (maker notified)". */
  @Post('batches/:id/decision') @RequirePermissions('payout.approve')
  decide(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(DecidePayoutBatchSchema) dto: DecidePayoutBatchDto) {
    return this.approvals.decide(ctx.tenantId, ctx.userId, id, { decision: dto.decision, note: dto.note }).then((data) => ({ data }));
  }

  /** W145's "Retry" on a failed row (W2443–W2445's chain). Requeues with the domain's backoff, and refuses
   *  by name where the destination itself is the problem. */
  @Post(':id/retry') @RequirePermissions('payout.approve')
  retry(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.approvals.retryPayout(ctx.tenantId, ctx.userId, id).then((data) => ({ data }));
  }

  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.payouts.getById(ctx.tenantId, this.actor(ctx), id, ctx.lang).then((data) => ({ data })); }
}
