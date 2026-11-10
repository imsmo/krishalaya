// modules/equipment/controllers/v1/equipment.controller.ts · owner asset registry + rate cards + browse.
// register/update/status/rates need equipment.manage (owner-only, enforced in service). Browse is any
// authenticated tenant user (renters shopping). `equipment` flag.
import { Controller, Get, Headers, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { EquipmentAssetService } from '../../services/equipment-asset.service';
import { EquipmentRateService } from '../../services/equipment-rate.service';
import { CreateAssetSchema, CreateAssetDto } from '../../dto/create-equipment-asset.dto';
import { UpdateAssetSchema, UpdateAssetDto, SetAssetStatusSchema, SetAssetStatusDto } from '../../dto/update-equipment-asset.dto';
import { QueryAssetsSchema, QueryAssetsDto } from '../../dto/query-equipment-asset.dto';
import { CreateRateSchema, CreateRateDto } from '../../dto/create-equipment-rate.dto';
import { QueryRatesSchema, QueryRatesDto } from '../../dto/query-equipment-rate.dto';
import { MaintenanceService } from '../../services/maintenance.service';
import { MaintenanceLogSchema, MaintenanceLogDto } from '../../dto/create-maintenance-log.dto';
import { EquipmentPermissions, canManageEquipment, canRentEquipment, isEquipmentAdmin } from '../../policies/equipment.policies';


const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'equipment/assets', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('equipment')
export class EquipmentController {
  constructor(private readonly assets: EquipmentAssetService, private readonly rates: EquipmentRateService, private readonly maintenance: MaintenanceService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageEquipment(ctx), canRent: canRentEquipment(ctx), isAdmin: isEquipmentAdmin(ctx) }; }

  @Post() @RequirePermissions(EquipmentPermissions.Manage)
  register(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(CreateAssetSchema) dto: CreateAssetDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.assets.register(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryAssetsSchema) q: QueryAssetsDto) {
    return this.assets.list(ctx.tenantId, this.actor(ctx), { box: q.box, categoryId: q.categoryId, status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.assets.getById(ctx.tenantId, id).then((data) => ({ data })); }
  @Patch(':id') @RequirePermissions(EquipmentPermissions.Manage)
  update(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(UpdateAssetSchema) dto: UpdateAssetDto) { return this.assets.update(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data })); }
  @Post(':id/status') @RequirePermissions(EquipmentPermissions.Manage)
  setStatus(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(SetAssetStatusSchema) dto: SetAssetStatusDto) { return this.assets.setStatus(ctx.tenantId, this.actor(ctx), id, dto.status as any).then((data) => ({ data })); }

  // --- PC-54 W54-12 `equipment-maintenance-alerts` (canon 312) over 0010 logs ---
  // [PC-56 OPS-4b · OPS4-B7 / E11] alerts: the caller's own machines (`booking.manage` keeps the organisation's view); record: the machine's OWNER
  // only, keyed (400 without), a strict DTO, not after the organisation's today, one audit row; logs: the owner only, anyone else 404.
  @Get('maintenance/alerts') @RequirePermissions(EquipmentPermissions.Manage)
  maintenanceAlerts(@CurrentContext() ctx: RequestContext) { return this.maintenance.alerts(ctx.tenantId, this.actor(ctx)).then((data) => ({ data })); }
  @Post(':id/maintenance-logs') @RequirePermissions(EquipmentPermissions.Manage)
  recordMaintenance(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(MaintenanceLogSchema) dto: MaintenanceLogDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.maintenance.record(ctx.tenantId, this.actor(ctx), id, key, dto, r.ip || null).then((data) => ({ data }));
  }
  @Get(':id/maintenance-logs')
  maintenanceLogs(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.maintenance.logs(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }

  @Post(':id/rates') @RequirePermissions(EquipmentPermissions.Manage)
  setRate(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(CreateRateSchema) dto: CreateRateDto) { return this.rates.setRate(ctx.tenantId, this.actor(ctx), id, dto, r.ip || null).then((data) => ({ data })); }   // [PC-56 OPS-4a] recorded
  @Get(':id/rates')
  listRates(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodQuery(QueryRatesSchema) q: QueryRatesDto) { return this.rates.list(ctx.tenantId, id, q.activeOnly).then((data) => ({ data })); }
}
