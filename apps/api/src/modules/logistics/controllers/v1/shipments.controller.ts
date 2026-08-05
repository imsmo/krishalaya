// modules/logistics/controllers/v1/shipments.controller.ts · shipment lifecycle (validate→authorize→
// delegate). create/assign/schedule/cancel need logistics.manage; pickup/transit/out-for-delivery/
// deliver/fail are manager-or-assigned-rider (enforced in the service). Delivery is OTP-gated. Gated by
// the `logistics` feature flag.
import { Controller, Get, Headers, Param, Post, Req, UseGuards, Query } from '@nestjs/common';
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
import { CodRemittanceService } from '../../services/cod-remittance.service';
import { z } from 'zod';
import { ShipmentPermissions, canManageLogistics } from '../../policies/logistics.policies';

const ipOf = (r: Request) => r.ip || null;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

const CreateRemittanceSchema = z.object({
  riderUserId: z.string().uuid(),
  shipmentIds: z.array(z.string().uuid()).min(1).max(500).optional(),   // omit = ALL of the rider's unremitted COD
  expectedAmountMinor: z.string().regex(/^\d{1,15}$/).optional(),       // optimistic check against a stale worksheet
  depositRef: z.string().trim().min(2).max(120).optional(),             // present ⇒ banked in the same breath
  depositMethod: z.enum(['bank_branch', 'cash_office', 'upi', 'other']).optional(),
  currencyCode: z.string().length(3).optional(),
}).strict();
const DepositSchema = z.object({ depositRef: z.string().trim().min(2).max(120), depositMethod: z.enum(['bank_branch', 'cash_office', 'upi', 'other']) }).strict();
const ReconcileSchema = z.object({ note: z.string().trim().max(1000).optional() }).strict();
const CancelSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

@Controller({ path: 'shipments', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('logistics')
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentService, private readonly remittances: CodRemittanceService) {}
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
  // --- PC-55 A2 `cod-remittance-ledger` (0082): rider cash → bank → second-pair-of-eyes ---
  @Post('cod/remittances') @RequirePermissions(ShipmentPermissions.Manage)
  createRemittance(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(CreateRemittanceSchema) dto: z.infer<typeof CreateRemittanceSchema>) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.remittances.create(ctx.tenantId, this.actor(ctx), key, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Get('cod/remittances') @RequirePermissions(ShipmentPermissions.Manage)
  listRemittances(@CurrentContext() ctx: RequestContext, @Query('riderUserId') riderUserId?: string, @Query('status') status?: string, @Query('limit') limit?: string) {
    return this.remittances.list(ctx.tenantId, this.actor(ctx), { riderUserId, status, limit: Number(limit) || 100 }).then((data) => ({ data }));
  }
  @Get('cod/remittances/:id') @RequirePermissions(ShipmentPermissions.Manage)
  getRemittance(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.remittances.get(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data }));
  }
  @Post('cod/remittances/:id/deposit') @RequirePermissions(ShipmentPermissions.Manage)
  depositRemittance(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(DepositSchema) dto: z.infer<typeof DepositSchema>) {
    return this.remittances.deposit(ctx.tenantId, this.actor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post('cod/remittances/:id/reconcile') @RequirePermissions(ShipmentPermissions.Manage)
  reconcileRemittance(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(ReconcileSchema) dto: { note?: string }) {
    return this.remittances.reconcile(ctx.tenantId, this.actor(ctx), id, dto.note, ipOf(r)).then((data) => ({ data }));
  }
  @Post('cod/remittances/:id/cancel') @RequirePermissions(ShipmentPermissions.Manage)
  cancelRemittance(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(CancelSchema) dto: { reason: string }) {
    return this.remittances.cancel(ctx.tenantId, this.actor(ctx), id, dto.reason, ipOf(r)).then((data) => ({ data }));
  }

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
