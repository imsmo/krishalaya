// modules/promotions/controllers/v1/promotions.controller.ts · promotion admin (validate→authorize→delegate). All endpoints
// need promotion.manage. Gated by the `promotions` feature flag (default OFF; OFF answers 404).
// PC-56 TENANT-10b: + POST /promotions/review (W2721, no write), GET /promotions/summary (W129's KPIs), the µs cursor and
// total on the list (F-17), and pause/resume with a REASON (W2724–W2726). STATIC ROUTES ARE DECLARED BEFORE `:id` — Express
// matches in declaration order, and `GET :id` would otherwise swallow `GET summary` (10a's route-shadow lesson; gated by
// tenant10b-promotions.spec.ts).
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { PromotionService } from '../../services/promotion.service';
import { OffersReadModel } from '../../read-models/offers.read-model';
import { CreatePromotionSchema, CreatePromotionDto } from '../../dto/create-promotion.dto';
import { SetPromotionActiveSchema, SetPromotionActiveDto } from '../../dto/update-promotion.dto';
import { QueryPromotionsSchema, QueryPromotionsDto } from '../../dto/query-promotion.dto';
import { ReviewPromotionSchema, ReviewPromotionDto } from '../../dto/review-promotion.dto';
import { PromotionPermissions, canManagePromotions } from '../../policies/promotions.policies';
import { PromotionForbiddenError, PromotionNotFoundError } from '../../domain/promotions.errors';
import { decodeCursor } from '../../domain/cursor';

const ipOf = (r: Request) => r.ip || null;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** A path id that is not a UUID names nothing — 404 by name, never a 500 from a uuid cast. */
const uuidParam = (id: string) => { if (!UUID.test(id)) throw new PromotionNotFoundError(id); return id; };

@Controller({ path: 'promotions', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('promotions')
export class PromotionsController {
  constructor(private readonly promotions: PromotionService, private readonly offers: OffersReadModel) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManagePromotions(ctx) }; }

  @Post() @RequirePermissions(PromotionPermissions.Manage)
  create(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(CreatePromotionSchema) dto: CreatePromotionDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.promotions.create(ctx.tenantId, this.actor(ctx), key, dto, ipOf(r)).then((data) => ({ data }));
  }

  @Post('review') @RequirePermissions(PromotionPermissions.Manage)
  review(@CurrentContext() ctx: RequestContext, @ZodBody(ReviewPromotionSchema) dto: ReviewPromotionDto) {
    return Promise.resolve({ data: this.promotions.review(this.actor(ctx), dto) });
  }

  @Get() @RequirePermissions(PromotionPermissions.Manage)
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryPromotionsSchema) q: QueryPromotionsDto) {
    return this.promotions.list(ctx.tenantId, this.actor(ctx), { activeOnly: q.activeOnly, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor, total: res.total } }));
  }

  @Get('summary') @RequirePermissions(PromotionPermissions.Manage)
  summary(@CurrentContext() ctx: RequestContext) {
    if (!canManagePromotions(ctx)) throw new PromotionForbiddenError('requires promotion.manage');
    return this.offers.summary(ctx.tenantId).then((data) => ({ data }));
  }

  @Get(':id') @RequirePermissions(PromotionPermissions.Manage)
  get(@CurrentContext() ctx: RequestContext, @Param('id') rawId: string) { return this.promotions.getById(ctx.tenantId, this.actor(ctx), uuidParam(rawId)).then((data) => ({ data })); }

  @Post(':id/active') @RequirePermissions(PromotionPermissions.Manage)
  setActive(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') rawId: string, @ZodBody(SetPromotionActiveSchema) dto: SetPromotionActiveDto) {
    return this.promotions.setActive(ctx.tenantId, this.actor(ctx), uuidParam(rawId), dto.isActive, dto.reason, ipOf(r)).then((data) => ({ data }));
  }
}
