// modules/payments/controllers/v1/payments.controller.ts · authed payment endpoints
// (validate → authorize → delegate). Creating an intent needs only authentication (a user pays
// for themselves); refunds require the wallet.adjust permission. Gated by the online_payments flag.
import { Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { AppConfig } from '../../../../core/config/app-config';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { PaymentService } from '../../services/payment.service';
import { CreatePaymentIntentSchema, CreatePaymentIntentDto, RefundPaymentSchema, RefundPaymentDto } from '../../dto/create-payment.dto';
import { PaymentPermissions, canModeratePayment } from '../../policies/payments.policies';

const ipOf = (req: Request) => req.ip || null;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'payments', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('online_payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentService, private readonly config: AppConfig) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canModerate: canModeratePayment(ctx) }; }

  @Post()
  create(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(CreatePaymentIntentSchema) dto: CreatePaymentIntentDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.payments.createIntent(ctx.tenantId, ctx.userId, key, dto).then((data) => ({ data }));
  }

  /** DEV-ONLY: complete a sandbox-provider payment (no real PSP configured) via the same signed-webhook
   *  path a real capture takes — see PaymentService.devCompleteSandboxPayment for the full safety
   *  argument. Double-guarded here too: explicitly refused in production, on top of the service's own
   *  providerCode==='sandbox' check (a real/Razorpay payment can never reach this path either way,
   *  since the sandbox gateway itself is only ever registered outside production). */
  @Post(':id/dev-complete-sandbox')
  devCompleteSandbox(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    if (this.config.payments.isProd) throw new BadRequestError('Not available in production');
    return this.payments.devCompleteSandboxPayment(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data }));
  }

  @Get()
  list(@CurrentContext() ctx: RequestContext, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return this.payments.list(ctx.tenantId, ctx.userId, { cursor: decodeCursor(cursor), limit: lim }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  /** PC-56 STORE-2c · B3 / C5 — an order's payment attempts as its BUYER sees them: the newest attempt (state, failure reason code, expiry,
   *  number), whether one is still live, and the number the next attempt carries (the storefront's key `order-pay:<orderId>:<attempt>`).
   *  Declared before ':id' so 'order' is not captured as a payment id. */
  @Get('order/:orderId/attempts')
  attempts(@CurrentContext() ctx: RequestContext, @Param('orderId') orderId: string) {
    if (!/^[0-9a-fA-F-]{36}$/.test(orderId)) throw new BadRequestError('orderId must be a uuid');
    return this.payments.attemptsForOrder(ctx.tenantId, this.actor(ctx), orderId).then((data) => ({ data }));
  }

  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.payments.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }

  @Post(':id/refund') @RequirePermissions(PaymentPermissions.Refund)
  refund(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(RefundPaymentSchema) dto: RefundPaymentDto) {
    return this.payments.refund(ctx.tenantId, this.actor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }
}
