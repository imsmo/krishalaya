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
import { CreatePayoutSchema, CreatePayoutDto } from '../../dto/create-payout.dto';
import { canModeratePayment } from '../../policies/payments.policies';

const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'payouts', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('online_payments')
export class PayoutsController {
  constructor(private readonly payouts: PayoutService, private readonly batches: PayoutBatchService) {}
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

  // --- PC-54 W54-6 payout-batch read-models (finance oversight; the RUN stays a job concern) ---
  @Get('batches') @RequirePermissions('payout.approve')
  listBatches(@Query('status') status?: string, @Query('batchType') batchType?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return this.batches.list({ status: status as never, batchType, cursor, limit: lim }).then((data) => ({ data }));
  }
  @Get('batches/:id') @RequirePermissions('payout.approve')
  async getBatch(@Param('id') id: string) {
    const data = await this.batches.getById(id);
    if (!data) throw new BadRequestError('batch not found');
    return { data };
  }

  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.payouts.getById(ctx.tenantId, this.actor(ctx), id, ctx.lang).then((data) => ({ data })); }
}
