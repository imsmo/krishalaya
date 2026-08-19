// modules/logistics/controllers/v1/partners.controller.ts · the fleet registry (validate→authorize→delegate, no
// logic): carriers, their vehicles, and a seller's pickup windows. Carrier/vehicle writes need logistics.manage;
// pickup slots are self-serve (owned by the calling seller). Gated by the `logistics` feature flag. Idempotency-
// Key required on every POST create.
import { Controller, Get, Headers, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { ShipmentPermissions, canManageLogistics } from '../../policies/logistics.policies';
import { LogisticsPartnerService } from '../../services/logistics-partner.service';
import { VehicleService } from '../../services/vehicle.service';
import { PickupSlotService } from '../../services/pickup-slot.service';
import { CreateLogisticsPartnerSchema, CreateLogisticsPartnerDto, UpdateLogisticsPartnerSchema, UpdateLogisticsPartnerDto, SetActiveSchema, SetActiveDto } from '../../dto/create-logistics-partner.dto';
import { QueryLogisticsPartnerSchema, QueryLogisticsPartnerDto } from '../../dto/query-logistics-partner.dto';
import { CreateVehicleSchema, CreateVehicleDto, UpdateVehicleSchema, UpdateVehicleDto } from '../../dto/create-vehicle.dto';
import { QueryVehicleSchema, QueryVehicleDto, QueryFleetRegisterSchema, QueryFleetRegisterDto } from '../../dto/query-vehicle.dto';
import { FleetRegisterReadModel } from '../../read-models/fleet-register.read-model';
import { CreatePickupSlotSchema, CreatePickupSlotDto, UpdatePickupSlotSchema, UpdatePickupSlotDto, QueryPickupSlotSchema, QueryPickupSlotDto } from '../../dto/create-pickup-slot.dto';

const ipOf = (r: Request) => r.ip || null;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };
const reqKey = (k: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };

@Controller({ path: 'logistics/partners', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('logistics')
export class PartnersController {
  constructor(private readonly partners: LogisticsPartnerService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageLogistics(ctx) }; }

  @Post() @RequirePermissions(ShipmentPermissions.Manage)
  create(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(CreateLogisticsPartnerSchema) dto: CreateLogisticsPartnerDto) {
    return this.partners.create(ctx.tenantId, this.actor(ctx), reqKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryLogisticsPartnerSchema) q: QueryLogisticsPartnerDto) {
    return this.partners.list(ctx.tenantId, { ...q, cursor: decodeCursor(q.cursor) }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.partners.getById(ctx.tenantId, id).then((data) => ({ data })); }
  @Patch(':id') @RequirePermissions(ShipmentPermissions.Manage)
  update(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(UpdateLogisticsPartnerSchema) dto: UpdateLogisticsPartnerDto) {
    return this.partners.update(ctx.tenantId, this.actor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/active') @RequirePermissions(ShipmentPermissions.Manage)
  setActive(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(SetActiveSchema) dto: SetActiveDto) {
    return this.partners.setActive(ctx.tenantId, this.actor(ctx), id, dto.isActive, ipOf(r)).then((data) => ({ data }));
  }
}

@Controller({ path: 'logistics/vehicles', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('logistics')
export class VehiclesController {
  constructor(private readonly vehicles: VehicleService, private readonly register: FleetRegisterReadModel) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageLogistics(ctx) }; }

  /**
   * **W229's fleet register (PC-56 TENANT-5b)** — the read that joins a vehicle to its RC for the first time,
   * masks the plate, and says what each vehicle is doing today.
   *
   * `logistics.manage` on a READ, unlike `GET /` above: W229's restricted state is explicit — "Vehicle
   * management needs logistics lead; RC docs follow KYC document rules" — and this row carries document status,
   * expiry dates and a live temperature. Declared BEFORE `:id` so the literal path is not swallowed by the
   * parameter route.
   */
  @Get('register') @RequirePermissions(ShipmentPermissions.Manage)
  fleetRegister(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryFleetRegisterSchema) q: QueryFleetRegisterDto) {
    return this.register.register(ctx.tenantId, { ...q, cursor: decodeCursor(q.cursor) })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor, split: res.split, mechanisms: res.mechanisms } }));
  }

  @Post() @RequirePermissions(ShipmentPermissions.Manage)
  create(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(CreateVehicleSchema) dto: CreateVehicleDto) {
    return this.vehicles.create(ctx.tenantId, this.actor(ctx), reqKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryVehicleSchema) q: QueryVehicleDto) {
    return this.vehicles.list(ctx.tenantId, { ...q, cursor: decodeCursor(q.cursor) }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.vehicles.getById(ctx.tenantId, id).then((data) => ({ data })); }
  @Patch(':id') @RequirePermissions(ShipmentPermissions.Manage)
  update(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(UpdateVehicleSchema) dto: UpdateVehicleDto) {
    return this.vehicles.update(ctx.tenantId, this.actor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/active') @RequirePermissions(ShipmentPermissions.Manage)
  setActive(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(SetActiveSchema) dto: SetActiveDto) {
    return this.vehicles.setActive(ctx.tenantId, this.actor(ctx), id, dto.isActive, ipOf(r)).then((data) => ({ data }));
  }
}

@Controller({ path: 'logistics/pickup-slots', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('logistics')
export class PickupSlotsController {
  constructor(private readonly slots: PickupSlotService) {}

  @Post()
  create(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(CreatePickupSlotSchema) dto: CreatePickupSlotDto) {
    return this.slots.create(ctx.tenantId, ctx.userId, reqKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryPickupSlotSchema) q: QueryPickupSlotDto) {
    return this.slots.list(ctx.tenantId, ctx.userId, { ...q, cursor: decodeCursor(q.cursor) }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.slots.getById(ctx.tenantId, ctx.userId, id).then((data) => ({ data })); }
  @Patch(':id')
  update(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(UpdatePickupSlotSchema) dto: UpdatePickupSlotDto) {
    return this.slots.update(ctx.tenantId, ctx.userId, id, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/active')
  setActive(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(SetActiveSchema) dto: SetActiveDto) {
    return this.slots.setActive(ctx.tenantId, ctx.userId, id, dto.isActive, ipOf(r)).then((data) => ({ data }));
  }
}
