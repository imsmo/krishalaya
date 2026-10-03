// modules/land-soil-weather/controllers/v1/parcels.controller.ts · land parcel registry. `land_soil_weather` flag.
import { Controller, Get, Headers, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { LandParcelService } from '../../services/land-parcel.service';
import { RegisterParcelSchema, RegisterParcelDto } from '../../dto/create-land-parcel.dto';
import { UpdateParcelSchema, UpdateParcelDto } from '../../dto/update-land-parcel.dto';
import { QueryParcelsSchema, QueryParcelsDto } from '../../dto/query-land-parcel.dto';
import { LandPermissions, canManageLand, isLandAdmin } from '../../policies/land-soil-weather.policies';

import { UUID_RE, decodeKeyset } from '../../../../shared/pagination/us-keyset';

@Controller({ path: 'land/parcels', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('land_soil_weather')
export class ParcelsController {
  constructor(private readonly svc: LandParcelService) {}
  private actor(ctx: RequestContext, req?: Request) { return { userId: ctx.userId, canManage: canManageLand(ctx), isAdmin: isLandAdmin(ctx), ip: req?.ip || null, requestId: ctx.requestId || null }; }

  @Post() @RequirePermissions(LandPermissions.Manage)
  register(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @ZodBody(RegisterParcelSchema) dto: RegisterParcelDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.register(ctx.tenantId, this.actor(ctx, req), key, dto).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryParcelsSchema) q: QueryParcelsDto) {
    return this.svc.list(ctx.tenantId, this.actor(ctx), { box: q.box, regionId: q.regionId, cursor: decodeKeyset(q.cursor, UUID_RE), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  /** The owner (`land.manage`) edits their own parcel; the land desk (`land.admin`) corrects another member's WITH a reason
   *  (both judged by the service; audited before/after either way). */
  @Patch(':id')
  update(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Param('id') id: string, @ZodBody(UpdateParcelSchema) dto: UpdateParcelDto) { return this.svc.update(ctx.tenantId, this.actor(ctx, req), id, dto).then((data) => ({ data })); }
}
