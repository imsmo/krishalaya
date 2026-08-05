// modules/logistics/controllers/v1/shipments.controller.ts · shipment lifecycle (validate→authorize→
// delegate). create/assign/schedule/cancel need logistics.manage; pickup/transit/out-for-delivery/
// deliver/fail are manager-or-assigned-rider (enforced in the service). Delivery is OTP-gated. Gated by
// the `logistics` feature flag.
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { ShipmentService } from '../../services/shipment.service';
import { CreateShipmentSchema, CreateShipmentDto } from '../../dto/create-shipment.dto';
import { AssignShipmentSchema, AssignShipmentDto, SchedulePickupSchema, SchedulePickupDto, DeliverShipmentSchema, DeliverShipmentDto, FailShipmentSchema, FailShipmentDto, ShipmentLocationSchema, ShipmentLocationDto } from '../../dto/update-shipment.dto';
import { QueryShipmentsSchema, QueryShipmentsDto } from '../../dto/query-shipment.dto';
import { ShipmentPermissions, canManageLogistics } from '../../policies/logistics.policies';

const ipOf = (r: Request) => r.ip || null;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'shipments', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('logistics')
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageLogistics(ctx) }; }

  @Post() @RequirePermissions(ShipmentPermissions.Manage)
  create(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(CreateShipmentSchema) dto: CreateShipmentDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.shipments.create(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }

  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryShipmentsSchema) q: QueryShipmentsDto) {
    return this.shipments.list(ctx.tenantId, this.actor(ctx), { box: q.box, status: q.status, orderId: q.orderId, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  // PC-54 W54-2 `cod-recon`: the outstanding-cash worksheet (Manage-gated; static path BEFORE ':id').
  @Get('cod/outstanding')
  @RequirePermissions(ShipmentPermissions.Manage)
  codOutstanding(@CurrentContext() ctx: RequestContext) {
    return this.shipments.codOutstanding(ctx.tenantId, this.actor(ctx)).then((data) => ({ data }));
  }

  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.shipments.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }

  @Post(':id/assign') @RequirePermissions(ShipmentPermissions.Manage)
  assign(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(AssignShipmentSchema) dto: AssignShipmentDto) {
    return this.shipments.assign(ctx.tenantId, this.actor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/schedule-pickup') @RequirePermissions(ShipmentPermissions.Manage)
  schedule(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(SchedulePickupSchema) dto: SchedulePickupDto) {
    return this.shipments.schedulePickup(ctx.tenantId, this.actor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/picked-up')
  pickedUp(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) { return this.shipments.markPickedUp(ctx.tenantId, this.actor(ctx), id, ipOf(r)).then((data) => ({ data })); }
  @Post(':id/in-transit')
  inTransit(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) { return this.shipments.markInTransit(ctx.tenantId, this.actor(ctx), id, ipOf(r)).then((data) => ({ data })); }
  @Post(':id/at-hub')
  atHub(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) { return this.shipments.markAtHub(ctx.tenantId, this.actor(ctx), id, ipOf(r)).then((data) => ({ data })); }
  @Post(':id/out-for-delivery')
  outForDelivery(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) { return this.shipments.markOutForDelivery(ctx.tenantId, this.actor(ctx), id, ipOf(r)).then((data) => ({ data })); }
  @Post(':id/deliver')
  deliver(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(DeliverShipmentSchema) dto: DeliverShipmentDto) {
    return this.shipments.markDelivered(ctx.tenantId, this.actor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/fail')
  fail(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(FailShipmentSchema) dto: FailShipmentDto) {
    return this.shipments.markFailed(ctx.tenantId, this.actor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/location')
  location(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(ShipmentLocationSchema) dto: ShipmentLocationDto) {
    return this.shipments.postLocation(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data }));
  }
  @Post(':id/cancel') @RequirePermissions(ShipmentPermissions.Manage)
  cancel(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) { return this.shipments.cancel(ctx.tenantId, this.actor(ctx), id, ipOf(r)).then((data) => ({ data })); }
}
