// modules/dairy/controllers/v1/rate-cards.controller.ts · milk rate card admin + browse. `dairy` flag.
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { MilkRateCardService } from '../../services/milk-rate-card.service';
import { CreateRateCardSchema, CreateRateCardDto } from '../../dto/create-milk-rate-card.dto';
import { QueryRateCardsSchema, QueryRateCardsDto } from '../../dto/query-milk-rate-card.dto';
import { DairyPermissions, canManageDairy, canCloseSettlement } from '../../policies/dairy.policies';

const ipOf = (r: Request) => r.ip || null;

@Controller({ path: 'dairy/rate-cards', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('dairy')
export class RateCardsController {
  constructor(private readonly cards: MilkRateCardService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageDairy(ctx), canCloseSettlement: canCloseSettlement(ctx) }; }

  @Post() @RequirePermissions(DairyPermissions.Manage)
  create(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(CreateRateCardSchema) dto: CreateRateCardDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.cards.create(ctx.tenantId, this.actor(ctx), key, dto, ipOf(r)).then((data) => ({ data }));
  }
  /**
   * [PC-56 HOTFIX-12 · founder Q1-A] THE SECOND PERSON. Same permission as create (`dairy.manage`); the creator is refused
   * by name (403 RATE_CARD_SECOND_PERSON_REQUIRED). Idempotency-Key required: the approval closes the predecessor and
   * tells the members, and a retried press must do neither twice.
   */
  @Post(':id/approve') @RequirePermissions(DairyPermissions.Manage)
  approve(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.cards.approve(ctx.tenantId, this.actor(ctx), key, id, ipOf(r)).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryRateCardsSchema) q: QueryRateCardsDto) {
    // [PC-56 OPS-3c] whether the caller holds `dairy.manage` decides whether `activeOnly=false` widens the list (MilkRateCardService.list).
    return this.cards.list(ctx.tenantId, { animalType: q.animalType, activeOnly: q.activeOnly }, ctx.userId, canManageDairy(ctx)).then((data) => ({ data }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.cards.getById(ctx.tenantId, id, ctx.userId).then((data) => ({ data })); }
}
