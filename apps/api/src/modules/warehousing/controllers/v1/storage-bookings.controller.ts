// modules/warehousing/controllers/v1/storage-bookings.controller.ts · deposit lifecycle + assays. `warehousing` flag.
// request/cancel = depositor (warehouse.store); confirm/store/release/assay = operator (warehouse.manage). PC-56 OPS-2b: the assay record is the
// warehouse's NAMED operator's only (403 WAREHOUSE_OPERATOR_ONLY, no admin escape) and audited.
// release is the money route (Idempotency-Key, Law 3).
import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { StorageBookingService } from '../../services/storage-booking.service';
import { AssayReportService } from '../../services/assay-report.service';
import { RequestBookingSchema, RequestBookingDto } from '../../dto/create-storage-booking.dto';
import { QueryBookingsSchema, QueryBookingsDto } from '../../dto/query-storage-booking.dto';
import { RecordAssaySchema, RecordAssayDto } from '../../dto/create-assay-report.dto';
import { WarehousingPermissions, canManageWarehouse, canStore, isWarehouseAdmin } from '../../policies/warehousing.policies';

const ipOf = (r: Request) => r.ip || null;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'warehousing/storage-bookings', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('warehousing')
export class StorageBookingsController {
  constructor(private readonly svc: StorageBookingService, private readonly assays: AssayReportService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageWarehouse(ctx), canStore: canStore(ctx), isAdmin: isWarehouseAdmin(ctx) }; }

  @Post() @RequirePermissions(WarehousingPermissions.Store)
  request(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(RequestBookingSchema) dto: RequestBookingDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.request(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryBookingsSchema) q: QueryBookingsDto) {
    return this.svc.list(ctx.tenantId, this.actor(ctx), { box: q.box, warehouseId: q.warehouseId, status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  @Post(':id/confirm') @RequirePermissions(WarehousingPermissions.Manage)
  confirm(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.confirm(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  @Post(':id/store') @RequirePermissions(WarehousingPermissions.Manage)
  store(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.store(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  @Post(':id/release') @RequirePermissions(WarehousingPermissions.Manage)
  release(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.release(ctx.tenantId, this.actor(ctx), id, key, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/cancel')
  cancel(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Body('reason') reason?: string) { return this.svc.cancel(ctx.tenantId, this.actor(ctx), id, reason).then((data) => ({ data })); }

  @Post(':id/assays') @RequirePermissions(WarehousingPermissions.Manage)
  recordAssay(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(RecordAssaySchema) dto: RecordAssayDto) {
    return this.assays.record(ctx.tenantId, this.actor(ctx), { ...dto, storageBookingId: id }, ipOf(r)).then((data) => ({ data }));
  }
  @Get(':id/assays')
  listAssays(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.assays.listForBooking(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
}
