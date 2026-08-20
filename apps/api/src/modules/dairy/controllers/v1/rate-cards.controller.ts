// modules/dairy/controllers/v1/rate-cards.controller.ts · milk rate card admin + browse. `dairy` flag.
import { Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
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

@Controller({ path: 'dairy/rate-cards', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('dairy')
export class RateCardsController {
  constructor(private readonly cards: MilkRateCardService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageDairy(ctx), canCloseSettlement: canCloseSettlement(ctx) }; }

  @Post() @RequirePermissions(DairyPermissions.Manage)
  create(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(CreateRateCardSchema) dto: CreateRateCardDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.cards.create(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryRateCardsSchema) q: QueryRateCardsDto) {
    return this.cards.list(ctx.tenantId, { animalType: q.animalType, activeOnly: q.activeOnly }).then((data) => ({ data }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.cards.getById(ctx.tenantId, id).then((data) => ({ data })); }
}
