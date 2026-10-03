// modules/land-soil-weather/controllers/v1/crop-seasons.controller.ts · crop-season lifecycle. `land_soil_weather` flag.
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { CropSeasonService } from '../../services/crop-season.service';
import { PlanCropSeasonSchema, PlanCropSeasonDto, SowCropSeasonSchema, SowCropSeasonDto, HarvestCropSeasonSchema, HarvestCropSeasonDto, AbandonCropSeasonSchema, AbandonCropSeasonDto } from '../../dto/create-crop-season.dto';
import { QueryCropSeasonsSchema, QueryCropSeasonsDto } from '../../dto/query-crop-season.dto';
import { LandPermissions, canManageLand, isLandAdmin } from '../../policies/land-soil-weather.policies';

@Controller({ path: 'land/crop-seasons', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('land_soil_weather')
export class CropSeasonsController {
  constructor(private readonly svc: CropSeasonService) {}
  private actor(ctx: RequestContext, req?: Request) { return { userId: ctx.userId, canManage: canManageLand(ctx), isAdmin: isLandAdmin(ctx), ip: req?.ip || null, requestId: ctx.requestId || null }; }

  @Post() @RequirePermissions(LandPermissions.Manage)
  plan(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @ZodBody(PlanCropSeasonSchema) dto: PlanCropSeasonDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.plan(ctx.tenantId, this.actor(ctx, req), key, dto).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryCropSeasonsSchema) q: QueryCropSeasonsDto) { return this.svc.list(ctx.tenantId, this.actor(ctx), q.parcelId, q.status).then((data) => ({ data })); }
  @Post(':id/sow') @RequirePermissions(LandPermissions.Manage)
  sow(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Param('id') id: string, @ZodBody(SowCropSeasonSchema) dto: SowCropSeasonDto) { return this.svc.sow(ctx.tenantId, this.actor(ctx, req), id, dto).then((data) => ({ data })); }
  @Post(':id/harvest') @RequirePermissions(LandPermissions.Manage)
  harvest(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Param('id') id: string, @ZodBody(HarvestCropSeasonSchema) dto: HarvestCropSeasonDto) { return this.svc.harvest(ctx.tenantId, this.actor(ctx, req), id, dto).then((data) => ({ data })); }
  @Post(':id/abandon') @RequirePermissions(LandPermissions.Manage)
  /** F-19: the reason is part of the .strict() contract (required, 3–300 characters) and lands on the audit row. */
  abandon(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Param('id') id: string, @ZodBody(AbandonCropSeasonSchema) dto: AbandonCropSeasonDto) { return this.svc.abandon(ctx.tenantId, this.actor(ctx, req), id, dto).then((data) => ({ data })); }
}
