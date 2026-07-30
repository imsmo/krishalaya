// modules/orders/controllers/v1/orders.controller.ts · order history + lifecycle.
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError, ForbiddenError } from '../../../../shared/errors/app-error';
import { OrderService } from '../../services/order.service';
import { OrderPaymentService } from '../../services/order-payment.service';
import { OrderItemService } from '../../services/order-item.service';
import { CheckoutGroupService } from '../../services/checkout-group.service';
import { OrderTimelineReadModel } from '../../read-models/order-timeline.read-model';
import { OrderTrackingReadModel } from '../../read-models/order-tracking.read-model';
import { OrderBuyerSummaryReadModel } from '../../read-models/order-buyer-summary.read-model';
import { TenantOrderStatsReadModel } from '../../read-models/tenant-order-stats.read-model';
import { QueryOrderSchema, QueryOrderDto } from '../../dto/query-order.dto';
import { CancelOrderSchema, CancelOrderDto, DisputeOrderSchema, DisputeOrderDto } from '../../dto/update-order.dto';
import { RecordDeliveredItemSchema, RecordDeliveredItemDto } from '../../dto/create-order-item.dto';
import { OrderPermissions, canModerateOrder } from '../../policies/orders.policies';

const ipOf = (req: Request) => req.ip || null;

@Controller({ path: 'orders', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
export class OrdersController {
  constructor(
    private readonly orders: OrderService,
    private readonly orderPay: OrderPaymentService,
    private readonly timeline: OrderTimelineReadModel,
    private readonly tracking: OrderTrackingReadModel,
    private readonly buyerSummary: OrderBuyerSummaryReadModel,
    private readonly orderItems: OrderItemService,
    private readonly groups: CheckoutGroupService,
    private readonly stats: TenantOrderStatsReadModel,
  ) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canModerate: canModerateOrder(ctx) }; }

  @Get() list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryOrderSchema) q: QueryOrderDto) {
    // DELTA-069 (DEV-50): explicit scope=tenant gives moderators the tenant-wide
    // per-order list (canon 547 worklist) — same actor rule stats() already uses.
    // Explicit deny beats silent fallback: a non-moderator asking for tenant scope
    // gets a ForbiddenError, not somebody else's idea of their own orders.
    let userId: string | null = ctx.userId;
    if (q.scope === 'tenant') {
      if (!canModerateOrder(ctx)) throw new ForbiddenError('scope=tenant requires order moderation permission');
      userId = null;
    }
    return this.timeline.list(ctx.tenantId, userId, q).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  // --- static routes declared BEFORE ':id' so they aren't captured as an order id ---
  /** Order stats: a moderator sees the whole tenant; a seller is scoped to their own orders. */
  @Get('stats') statsFor(@CurrentContext() ctx: RequestContext) {
    const a = this.actor(ctx);
    return this.stats.stats(ctx.tenantId, { sellerUserId: a.canModerate ? null : ctx.userId }).then((data) => ({ data }));
  }
  /** The caller's checkout groups (multi-seller payments). */
  @Get('checkout-groups') groupList(@CurrentContext() ctx: RequestContext) {
    return this.groups.listForBuyer(ctx.tenantId, ctx.userId, { limit: 20 }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get('checkout-groups/:groupId') groupGet(@CurrentContext() ctx: RequestContext, @Param('groupId') groupId: string) {
    return this.groups.getGroup(ctx.tenantId, this.actor(ctx), groupId).then((data) => ({ data }));
  }

  @Get(':id') get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.orders.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }

  /** An order's frozen line items (buyer/seller/moderator). */
  @Get(':id/items') items(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.orderItems.listForOrder(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  /** Order-tracking feed (buyer/seller/moderator): stamped order-status transitions + the shipment's
   *  status/location timeline (real per-step timestamps; lat/lng when a rider has posted one). */
  @Get(':id/tracking') trackingFeed(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.tracking.tracking(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  /** Buyer trust summary for the seller's accept/reject decision (seller/moderator only). */
  @Get(':id/buyer-summary') buyerSummaryFor(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.buyerSummary.forOrder(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  /** Seller records the delivered quantity for one line (partial fulfilment). */
  @Post(':id/items/:listingId/delivered') @RequirePermissions(OrderPermissions.Manage)
  recordDelivered(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Param('listingId') listingId: string, @ZodBody(RecordDeliveredItemSchema) dto: RecordDeliveredItemDto) {
    return this.orderItems.recordDelivered(ctx.tenantId, this.actor(ctx), id, listingId, dto.deliveredQuantity).then((data) => ({ data }));
  }

  @Post(':id/confirm')  @RequirePermissions(OrderPermissions.Manage)
  confirm(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) { return this.orders.confirm(ctx.tenantId, this.actor(ctx), id, ipOf(r)).then(() => ({ data: { ok: true } })); }
  @Post(':id/packed')   @RequirePermissions(OrderPermissions.Manage)
  packed(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) { return this.orders.markPacked(ctx.tenantId, this.actor(ctx), id, ipOf(r)).then(() => ({ data: { ok: true } })); }
  @Post(':id/ready')    @RequirePermissions(OrderPermissions.Manage)
  ready(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) { return this.orders.markReady(ctx.tenantId, this.actor(ctx), id, ipOf(r)).then(() => ({ data: { ok: true } })); }
  @Post(':id/delivered') @RequirePermissions(OrderPermissions.Manage)
  delivered(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) { return this.orders.markDelivered(ctx.tenantId, this.actor(ctx), id, ipOf(r)).then(() => ({ data: { ok: true } })); }

  /** Buyer pays an awaiting-payment order from their OWN wallet balance (alternative to the gateway).
   *  Idempotent (Law 3). Amount is the order's server total; the service re-resolves the buyer from the
   *  loaded order (no IDOR). order.create = the buyer's own permission (they created/own the order). */
  @Post(':id/pay-from-wallet') @RequirePermissions(OrderPermissions.Create)
  async payFromWallet(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @Param('id') id: string) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return { data: await this.orderPay.payFromWallet(ctx.tenantId, ctx.userId, key, id) };
  }

  // cancel/complete/dispute: any authed party; the entity + service enforce buyer/seller ownership
  @Post(':id/cancel')
  cancel(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(CancelOrderSchema) dto: CancelOrderDto) { return this.orders.cancel(ctx.tenantId, this.actor(ctx), id, dto.reasonId ?? null, ipOf(r)).then(() => ({ data: { ok: true } })); }
  @Post(':id/complete')
  complete(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) { return this.orders.complete(ctx.tenantId, this.actor(ctx), id, ipOf(r)).then(() => ({ data: { ok: true } })); }
  @Post(':id/dispute')
  dispute(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(DisputeOrderSchema) dto: DisputeOrderDto) { return this.orders.dispute(ctx.tenantId, this.actor(ctx), id, dto.note, ipOf(r)).then(() => ({ data: { ok: true } })); }
}
