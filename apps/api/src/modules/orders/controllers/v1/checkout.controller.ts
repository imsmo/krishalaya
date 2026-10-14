// modules/orders/controllers/v1/checkout.controller.ts · convert the active cart into orders.
import { Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { CheckoutService } from '../../services/checkout.service';
import { CheckoutSchema, CheckoutDto, CheckoutPreviewSchema, CheckoutPreviewDto, DeliveryMethodsQuerySchema, DeliveryMethodsQueryDto } from '../../dto/create-order.dto';
import { OrderPermissions } from '../../policies/orders.policies';
import { StorefrontCartGuard } from '../../storefront-cart.guard';

@Controller({ path: 'checkout', version: '1' })
// PC-56 STORE-2b · B5 (founder D2): buying's one kill-switch on placement, the preview and the delivery-methods read (503 STOREFRONT_CART_OFF),
// after the auth guards.
@UseGuards(AuthGuard, PermissionsGuard, StorefrontCartGuard)
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  // Read-only totals preview (no order, no money moved) — server-authoritative bill before checkout.
  @Post('preview') @RequirePermissions(OrderPermissions.Create)
  preview(@CurrentContext() ctx: RequestContext, @ZodBody(CheckoutPreviewSchema) dto: CheckoutPreviewDto) {
    return this.checkout.previewTotals(ctx.tenantId, ctx.userId, dto).then((data) => ({ data }));
  }

  // Read-only delivery-methods lookup for the active cart + destination (no order, no money moved). Lets the
  // buyer see their serviceable delivery options + fees before paying; placement always recomputes server-side.
  @Get('delivery-methods') @RequirePermissions(OrderPermissions.Create)
  deliveryMethods(@CurrentContext() ctx: RequestContext, @ZodQuery(DeliveryMethodsQuerySchema) q: DeliveryMethodsQueryDto) {
    return this.checkout.deliveryMethods(ctx.tenantId, ctx.userId, q).then((data) => ({ data }));
  }
  // Idempotency is owned by CheckoutService (it wraps the whole cart→orders tx under this key).
  // The controller MUST NOT also wrap it — a second remember() with the same scoped key would see
  // the service's in-progress claim and wrongly reject the very first request as a duplicate.
  @Post() @RequirePermissions(OrderPermissions.Create)
  async go(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(CheckoutSchema) dto: CheckoutDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    const data = await this.checkout.checkout(ctx.tenantId, ctx.userId, key, dto);
    return { data };
  }
}
