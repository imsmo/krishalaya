// modules/warehousing/controllers/v1/warehouses.controller.ts · warehouse listing + browse. `warehousing` flag.
import { Controller, Get, Headers, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { WarehouseService } from '../../services/warehouse.service';
import { CreateWarehouseSchema, CreateWarehouseDto } from '../../dto/create-warehouse.dto';
import { UpdateWarehouseSchema, UpdateWarehouseDto } from '../../dto/update-warehouse.dto';
import { QueryWarehousesSchema, QueryWarehousesDto } from '../../dto/query-warehouse.dto';
import { WarehousingPermissions, canManageWarehouse, canStore } from '../../policies/warehousing.policies';

const ipOf = (r: Request) => r.ip || null;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'warehousing/warehouses', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('warehousing')
export class WarehousesController {
  constructor(private readonly svc: WarehouseService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageWarehouse(ctx), canStore: canStore(ctx) }; }   // PC-56 OPS-2a: no administrator escape (Q11-A)

  @Post() @RequirePermissions(WarehousingPermissions.Manage)
  register(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(CreateWarehouseSchema) dto: CreateWarehouseDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.register(ctx.tenantId, this.actor(ctx), key, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryWarehousesSchema) q: QueryWarehousesDto) {
    return this.svc.list(ctx.tenantId, this.actor(ctx), { box: q.box, activeOnly: q.activeOnly, cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.getById(ctx.tenantId, id).then((data) => ({ data })); }
  @Patch(':id') @RequirePermissions(WarehousingPermissions.Manage)
  update(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(UpdateWarehouseSchema) dto: UpdateWarehouseDto) { return this.svc.update(ctx.tenantId, this.actor(ctx), id, dto, ipOf(r)).then((data) => ({ data })); }
}
