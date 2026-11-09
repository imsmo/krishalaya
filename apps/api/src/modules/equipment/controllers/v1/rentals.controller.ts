// modules/equipment/controllers/v1/rentals.controller.ts · the rental booking lifecycle + escrow settlement.
// request/confirm/confirm-usage/cancel are the renter (equipment.rent); quote/start/complete/settle are the owner
// (equipment.manage) — [PC-56 HOTFIX-13] the machine's owner ONLY, no administrator escape; confirm and confirm-usage the renter ONLY. Money routes (confirm, settle) require an Idempotency-Key (Law 3). `equipment` flag.
import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { EquipmentBookingService } from '../../services/equipment-booking.service';
import { RequestBookingSchema, RequestBookingDto, QuoteBookingSchema, QuoteBookingDto, StartBookingSchema, StartBookingDto, CompleteBookingSchema, CompleteBookingDto } from '../../dto/create-equipment-booking.dto';
import { QueryBookingsSchema, QueryBookingsDto } from '../../dto/query-equipment-booking.dto';
import { EquipmentPermissions, canManageEquipment, canRentEquipment, isEquipmentAdmin } from '../../policies/equipment.policies';

const ipOf = (r: Request) => r.ip || null;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'equipment/rentals', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('equipment')
export class RentalsController {
  constructor(private readonly svc: EquipmentBookingService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageEquipment(ctx), canRent: canRentEquipment(ctx), isAdmin: isEquipmentAdmin(ctx) }; }

  @Post() @RequirePermissions(EquipmentPermissions.Rent)
  request(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(RequestBookingSchema) dto: RequestBookingDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.request(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryBookingsSchema) q: QueryBookingsDto) {
    return this.svc.list(ctx.tenantId, this.actor(ctx), { box: q.box, status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }

  @Post(':id/quote') @RequirePermissions(EquipmentPermissions.Manage)
  quote(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(QuoteBookingSchema) dto: QuoteBookingDto) { return this.svc.quote(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data })); }

  @Post(':id/confirm') @RequirePermissions(EquipmentPermissions.Rent)
  confirm(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.confirm(ctx.tenantId, this.actor(ctx), id, key).then((data) => ({ data }));
  }
  @Post(':id/start') @RequirePermissions(EquipmentPermissions.Manage)
  start(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(StartBookingSchema) dto: StartBookingDto) { return this.svc.start(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data })); }
  @Post(':id/complete') @RequirePermissions(EquipmentPermissions.Manage)
  complete(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(CompleteBookingSchema) dto: CompleteBookingDto) { return this.svc.complete(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data })); }
  @Post(':id/settle') @RequirePermissions(EquipmentPermissions.Manage)
  settle(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.settle(ctx.tenantId, this.actor(ctx), id, key, ipOf(r)).then((data) => ({ data }));
  }
  /**
   * [PC-56 HOTFIX-13 · founder Q1-A] The RENTER confirms the hours the owner recorded, in her own session. Until she does, settle
   * takes nothing beyond the deposit. Idempotency-Keyed (Law 3); anyone but the renter → 403 USAGE_CONFIRM_NOT_RENTER.
   */
  @Post(':id/confirm-usage') @RequirePermissions(EquipmentPermissions.Rent)
  confirmUsage(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.confirmUsage(ctx.tenantId, this.actor(ctx), id, key, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/cancel')
  cancel(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Body('reason') reason?: string) { return this.svc.cancel(ctx.tenantId, this.actor(ctx), id, reason).then((data) => ({ data })); }
}
