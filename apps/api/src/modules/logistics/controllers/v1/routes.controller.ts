// modules/logistics/controllers/v1/routes.controller.ts · Village Run routes + cold-chain telemetry
// (validate→authorize→delegate, no logic). All writes need logistics.manage; gated by the `logistics` flag.
// Route creates require an Idempotency-Key; cold-chain readings are append-only (idempotency unnecessary — each
// reading is a distinct timestamped fact). Lists are keyset/bounded.
import { Controller, Get, Headers, Param, Patch, Post, Req, UseGuards, Query } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { ShipmentPermissions, canManageLogistics } from '../../policies/logistics.policies';
import { DeliveryRouteService } from '../../services/delivery-route.service';
import { ColdChainService } from '../../services/cold-chain.service';
import { CreateDeliveryRouteSchema, CreateDeliveryRouteDto, UpdateDeliveryRouteSchema, UpdateDeliveryRouteDto } from '../../dto/create-delivery-route.dto';
import { QueryDeliveryRouteSchema, QueryDeliveryRouteDto } from '../../dto/query-delivery-route.dto';
import { ZoneSetActiveSchema, ZoneSetActiveDto } from '../../dto/create-delivery-zone.dto';
import { RecordColdChainSchema, RecordColdChainDto, QueryColdChainSchema, QueryColdChainDto } from '../../dto/cold-chain.dto';

const ipOf = (r: Request) => r.ip || null;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };
const reqKey = (k: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };

@Controller({ path: 'logistics/routes', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('logistics')
export class RoutesController {
  constructor(private readonly routes: DeliveryRouteService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageLogistics(ctx) }; }

  @Post() @RequirePermissions(ShipmentPermissions.Manage)
  create(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(CreateDeliveryRouteSchema) dto: CreateDeliveryRouteDto) {
    return this.routes.create(ctx.tenantId, this.actor(ctx), reqKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryDeliveryRouteSchema) q: QueryDeliveryRouteDto) {
    return this.routes.list(ctx.tenantId, { ...q, cursor: decodeCursor(q.cursor) }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.routes.getById(ctx.tenantId, id).then((data) => ({ data })); }
  @Patch(':id') @RequirePermissions(ShipmentPermissions.Manage)
  update(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(UpdateDeliveryRouteSchema) dto: UpdateDeliveryRouteDto) {
    return this.routes.update(ctx.tenantId, this.actor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/active') @RequirePermissions(ShipmentPermissions.Manage)
  setActive(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(ZoneSetActiveSchema) dto: ZoneSetActiveDto) {
    return this.routes.setActive(ctx.tenantId, this.actor(ctx), id, dto.isActive, ipOf(r)).then((data) => ({ data }));
  }
}

@Controller({ path: 'logistics/cold-chain', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('logistics')
export class ColdChainController {
  constructor(private readonly coldChain: ColdChainService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageLogistics(ctx) }; }

  @Post('readings') @RequirePermissions(ShipmentPermissions.Manage)
  record(@CurrentContext() ctx: RequestContext, @ZodBody(RecordColdChainSchema) dto: RecordColdChainDto) {
    return this.coldChain.record(ctx.tenantId, this.actor(ctx), dto).then((data) => ({ data }));
  }
  // PC-54 W54-12: iot-device-fleet + ops-alerting v1 (read-models over the ledgered readings).
  @Get('devices') @RequirePermissions(ShipmentPermissions.Manage)
  devices(@CurrentContext() ctx: RequestContext) { return this.coldChain.deviceFleet(ctx.tenantId).then((data) => ({ data })); }
  @Get('breaches') @RequirePermissions(ShipmentPermissions.Manage)
  breaches(@CurrentContext() ctx: RequestContext, @Query('hours') hours?: string, @Query('limit') limit?: string) {
    return this.coldChain.breaches(ctx.tenantId, Number(hours) || 24, Number(limit) || 100).then((data) => ({ data }));
  }

  @Get('readings') @RequirePermissions(ShipmentPermissions.Manage)
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryColdChainSchema) q: QueryColdChainDto) {
    return this.coldChain.listForSubject(ctx.tenantId, { ...q, cursor: decodeCursor(q.cursor) }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
}
