// modules/market-intel/controllers/v1/predictions.controller.ts · fair-price bands.
// generate needs market.manage; the latest-band read is any authenticated user. `market_intel` flag.
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { MarketPermissions, canManageMarket } from '../../policies/market-intel.policies';
import { PricePredictionService } from '../../services/price-prediction.service';
import { GeneratePredictionSchema, GeneratePredictionDto } from '../../dto/create-price-prediction.dto';
import { QueryPredictionSchema, QueryPredictionDto } from '../../dto/query-price-prediction.dto';

@Controller({ path: 'market/predictions', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('market_intel')
export class PredictionsController {
  constructor(private readonly svc: PricePredictionService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageMarket(ctx) }; }

  @Post() @RequirePermissions(MarketPermissions.Manage)
  generate(@CurrentContext() ctx: RequestContext, @ZodBody(GeneratePredictionSchema) dto: GeneratePredictionDto) { return this.svc.generate(ctx.tenantId, this.actor(ctx), dto).then((data) => ({ data })); }
  @Get()
  latest(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryPredictionSchema) q: QueryPredictionDto) { return this.svc.latest(ctx.tenantId, q.productId, q.regionId).then((data) => ({ data })); }
}
