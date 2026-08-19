// modules/logistics/controllers/v1/freight.controller.ts · the freight desk's HTTP surface
// (validate → authorize → delegate, no logic). PC-56 TENANT-5c.
//
// **`freight_invoices` HAS HAD NO CONTROLLER SINCE 0070** — no route, no DTO, no client. W241 ("Upload carrier
// invoice") and W242 ("Pay matched lines", "Disputed lines (4)") were drawings over a table with an RLS policy and
// no writer.
//
// Every write needs `logistics.manage`; every one of them is money-adjacent, so every one carries an
// Idempotency-Key (Law 3) except the dispute, which is idempotent by construction (disputing an already-disputed
// line rewrites the same row with the operator's newest words). Gated by `logistics_freight_recon` (Law 10, OFF).
import { Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { ShipmentPermissions, canManageLogistics } from '../../policies/logistics.policies';
import { FreightInvoiceService } from '../../services/freight-invoice.service';
import { FreightDeskReadModel } from '../../read-models/freight-desk.read-model';
import {
  CreateFreightInvoiceSchema, CreateFreightInvoiceDto, DisputeFreightLineSchema, DisputeFreightLineDto,
  ResolveFreightLineSchema, ResolveFreightLineDto,
} from '../../dto/create-freight-invoice.dto';
import { QueryFreightInvoiceSchema, QueryFreightInvoiceDto } from '../../dto/query-freight-invoice.dto';

const ipOf = (r: Request) => r.ip || null;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };
const reqKey = (k: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };

@Controller({ path: 'logistics/freight-invoices', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('logistics_freight_recon')
export class FreightController {
  constructor(private readonly freight: FreightInvoiceService, private readonly desk: FreightDeskReadModel) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageLogistics(ctx) }; }

  /** W241's list — with the cycle count and the quarter's recovery figure in `meta`. */
  @Get() @RequirePermissions(ShipmentPermissions.Manage)
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryFreightInvoiceSchema) q: QueryFreightInvoiceDto,
       @Query('cycleFrom') cycleFrom?: string, @Query('cycleTo') cycleTo?: string) {
    return this.desk.desk(ctx.tenantId, this.actor(ctx), { ...q, cursor: decodeCursor(q.cursor), cycleFrom, cycleTo })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor, cycle: res.cycle, recovered: res.recovered } }));
  }

  /** W241's [Upload carrier invoice] → W2612–W2615's form chain. */
  @Post() @RequirePermissions(ShipmentPermissions.Manage)
  record(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string,
         @ZodBody(CreateFreightInvoiceSchema) dto: CreateFreightInvoiceDto) {
    return this.freight.record(ctx.tenantId, this.actor(ctx), reqKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }

  /** W242's whole screen: the lines, their verdicts, what is clean, what is disputed, what may be paid. */
  @Get(':id/recon') @RequirePermissions(ShipmentPermissions.Manage)
  recon(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.desk.recon(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data }));
  }

  @Get(':id') @RequirePermissions(ShipmentPermissions.Manage)
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.freight.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data }));
  }

  /** Run (or re-run) the match. Idempotent per key: one decision, one audit row. */
  @Post(':id/reconcile') @RequirePermissions(ShipmentPermissions.Manage)
  reconcile(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string) {
    return this.freight.reconcile(ctx.tenantId, this.actor(ctx), reqKey(key), id, ipOf(r)).then((data) => ({ data }));
  }

  @Post(':id/lines/:lineId/dispute') @RequirePermissions(ShipmentPermissions.Manage)
  dispute(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Param('lineId') lineId: string,
          @ZodBody(DisputeFreightLineSchema) dto: DisputeFreightLineDto) {
    return this.freight.disputeLine(ctx.tenantId, this.actor(ctx), id, lineId, dto, ipOf(r)).then((data) => ({ data }));
  }

  /** Agreed or withdrawn. This one changes the invoice total, so it needs a key. */
  @Post(':id/lines/:lineId/resolve') @RequirePermissions(ShipmentPermissions.Manage)
  resolve(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string,
          @Param('id') id: string, @Param('lineId') lineId: string, @ZodBody(ResolveFreightLineSchema) dto: ResolveFreightLineDto) {
    return this.freight.resolveLine(ctx.tenantId, this.actor(ctx), reqKey(key), id, lineId, dto, ipOf(r)).then((data) => ({ data }));
  }

  /** Close the recon — or book a cost note to ops. Releases W241's payment hold; pays nothing, because the rails
   *  cannot carry a carrier payee (the wave's named gap). */
  @Post(':id/close') @RequirePermissions(ShipmentPermissions.Manage)
  close(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string) {
    return this.freight.close(ctx.tenantId, this.actor(ctx), reqKey(key), id, ipOf(r)).then((data) => ({ data }));
  }
}
