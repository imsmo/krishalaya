// modules/promotions/controllers/v1/coupons.controller.ts · coupon admin + validate (preview) + redeem.
// Admin routes need promotion.manage; validate / redeem / my-redemptions are any authenticated tenant user (the redeemer
// is ctx.userId; every rule is the service's). Gated by the `promotions` feature flag — coupons have no flag of their own.
// PC-56 TENANT-10b: + POST /coupons/review (W2540), GET /coupons/all (B1 — W130's tenant-wide list, µs cursor + total),
// GET /coupons/:id/redemptions (W130's panel: applied + declined, masked buyer + place), DELETE /coupons/:id with a reason
// (404 when nothing was deleted — F-12). validate / redeem now ANSWER (applied | a declined outcome with a kind notice
// key) instead of throwing (F-21 / F-22). Static routes before parametric ones (the route-shadow gate).
import { Controller, Delete, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { CouponService } from '../../services/coupon.service';
import { OffersReadModel } from '../../read-models/offers.read-model';
import { CreateCouponSchema, CreateCouponDto } from '../../dto/create-coupon.dto';
import { ValidateCouponSchema, ValidateCouponDto, RedeemCouponSchema, RedeemCouponDto } from '../../dto/create-coupon-redemption.dto';
import { QueryCouponsSchema, QueryCouponsDto } from '../../dto/query-coupon.dto';
import { QueryRedemptionsSchema, QueryRedemptionsDto } from '../../dto/query-coupon-redemption.dto';
import { QueryCouponsAllSchema, QueryCouponsAllDto } from '../../dto/query-coupon-all.dto';
import { ReviewCouponSchema, ReviewCouponDto, DeleteCouponSchema, DeleteCouponDto } from '../../dto/review-promotion.dto';
import { PromotionPermissions, canManagePromotions } from '../../policies/promotions.policies';
import { CouponNotFoundError, PromotionForbiddenError } from '../../domain/promotions.errors';
import { decodeCursor } from '../../domain/cursor';

const ipOf = (r: Request) => r.ip || null;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** A path id that is not a UUID names nothing — 404 by name, never a 500 from a uuid cast. */
const uuidParam = (id: string) => { if (!UUID.test(id)) throw new CouponNotFoundError(); return id; };

@Controller({ path: 'coupons', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('promotions')
export class CouponsController {
  constructor(private readonly coupons: CouponService, private readonly offers: OffersReadModel) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManagePromotions(ctx) }; }
  private assertManager(ctx: RequestContext) { if (!canManagePromotions(ctx)) throw new PromotionForbiddenError('requires promotion.manage'); }

  @Post() @RequirePermissions(PromotionPermissions.Manage)
  create(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(CreateCouponSchema) dto: CreateCouponDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.coupons.createCoupon(ctx.tenantId, this.actor(ctx), key, dto, ipOf(r)).then((data) => ({ data }));
  }

  @Post('review') @RequirePermissions(PromotionPermissions.Manage)
  review(@CurrentContext() ctx: RequestContext, @ZodBody(ReviewCouponSchema) dto: ReviewCouponDto) {
    return this.coupons.reviewCoupon(ctx.tenantId, this.actor(ctx), dto).then((data) => ({ data }));
  }

  /** One promotion's coupons (the promotionId is REQUIRED — the SDK used to omit it, F-7). */
  @Get() @RequirePermissions(PromotionPermissions.Manage)
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryCouponsSchema) q: QueryCouponsDto) {
    return this.coupons.listForPromotion(ctx.tenantId, this.actor(ctx), q.promotionId, { cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  /** B1 — every live coupon of the tenant (W130). */
  @Get('all') @RequirePermissions(PromotionPermissions.Manage)
  listAll(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryCouponsAllSchema) q: QueryCouponsAllDto) {
    this.assertManager(ctx);
    return this.offers.coupons(ctx.tenantId, { cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor, total: res.total } }));
  }

  /** The CALLER's own redemptions (a buyer's history) — not W130's panel. */
  @Get('redemptions')
  myRedemptions(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryRedemptionsSchema) q: QueryRedemptionsDto) {
    return this.coupons.listMyRedemptions(ctx.tenantId, ctx.userId, { cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  @Post('validate')
  validate(@CurrentContext() ctx: RequestContext, @ZodBody(ValidateCouponSchema) dto: ValidateCouponDto) {
    return this.coupons.validate(ctx.tenantId, ctx.userId, dto.code, BigInt(dto.subtotalMinor)).then((data) => ({ data }));
  }

  @Post('redeem')
  redeem(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(RedeemCouponSchema) dto: RedeemCouponDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.coupons.redeem(ctx.tenantId, ctx.userId, key, { code: dto.code, orderId: dto.orderId, subtotalMinor: BigInt(dto.subtotalMinor) }).then((data) => ({ data }));
  }

  /** W130's "Recent redemptions" for one coupon: applied (with the money's state) and declined attempts (with why). */
  @Get(':id/redemptions') @RequirePermissions(PromotionPermissions.Manage)
  redemptions(@CurrentContext() ctx: RequestContext, @Param('id') rawId: string, @ZodQuery(QueryCouponsAllSchema) q: QueryCouponsAllDto) {
    this.assertManager(ctx);
    return this.offers.couponRedemptions(ctx.tenantId, uuidParam(rawId), { cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  /** One live coupon as W130 shows it (the delete chain confirms against it). Declared AFTER every static GET. */
  @Get(':id') @RequirePermissions(PromotionPermissions.Manage)
  getOne(@CurrentContext() ctx: RequestContext, @Param('id') rawId: string) {
    this.assertManager(ctx);
    return this.offers.coupon(ctx.tenantId, uuidParam(rawId)).then((row) => { if (!row) throw new CouponNotFoundError(); return { data: row }; });
  }

  @Delete(':id') @RequirePermissions(PromotionPermissions.Manage)
  remove(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') rawId: string, @ZodBody(DeleteCouponSchema) dto: DeleteCouponDto) {
    return this.coupons.deleteCoupon(ctx.tenantId, this.actor(ctx), uuidParam(rawId), dto.reason, ipOf(r)).then((data) => ({ data }));
  }
}
