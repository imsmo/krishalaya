// modules/logistics/controllers/v1/zones.controller.ts · PC-56 TENANT-SW-a · W233 — delivery zones, lead + checker (validate → authorize →
// delegate, no logic). Gated by the `logistics` flag. Reads: any signed-in member. Writes: `logistics.zones.manage` (tenant_admin or
// fpo_coordinator; the CONFIRMER must also be a different active tenant_admin — 0196), every write keyed. A zone is created, its fee
// re-pointed or its state changed only by a confirmed proposal; name / pincodes / regions are a direct, reasoned edit.
import { Body, Controller, Get, Headers, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { canManageZones, ZONES_MANAGE } from '../../policies/logistics.policies';
import { DeliveryZoneService } from '../../services/delivery-zone.service';
import {
  ProposeZoneSchema, ProposeZoneDto, UpdateDeliveryZoneSchema, UpdateDeliveryZoneDto, RefuseZoneProposalSchema, RefuseZoneProposalDto,
  ServiceabilityQuerySchema, ServiceabilityQueryDto, QueryZoneProposalSchema, QueryZoneProposalDto,
} from '../../dto/create-delivery-zone.dto';
import { QueryDeliveryZoneSchema, QueryDeliveryZoneDto } from '../../dto/query-delivery-zone.dto';

const ipOf = (r: Request) => r.ip || null;
const reqKey = (k: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };

@Controller({ path: 'logistics/zones', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('logistics')
export class ZonesController {
  constructor(private readonly zones: DeliveryZoneService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canPropose: canManageZones(ctx) }; }

  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryDeliveryZoneSchema) q: QueryDeliveryZoneDto) {
    return this.zones.list(ctx.tenantId, q).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  /** "Does this pincode get delivery?" — the zones that serve it (W233's test box). */
  @Get('serviceability')
  serviceability(@CurrentContext() ctx: RequestContext, @ZodQuery(ServiceabilityQuerySchema) q: ServiceabilityQueryDto) {
    return this.zones.serviceability(ctx.tenantId, q.pincode).then((data) => ({ data }));
  }
  /** The fee definitions a zone may point at (this tenant's, approved by a second person on W150). */
  @Get('fee-definitions')
  feeDefinitions(@CurrentContext() ctx: RequestContext) { return this.zones.approvedFeeDefinitions(ctx.tenantId).then((data) => ({ data })); }
  @Get('proposals')
  proposals(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryZoneProposalSchema) q: QueryZoneProposalDto) {
    return this.zones.listProposals(ctx.tenantId, ctx.userId, q).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get('proposals/:id')
  proposal(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.zones.getProposal(ctx.tenantId, ctx.userId, id).then((data) => ({ data })); }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.zones.getById(ctx.tenantId, id).then((data) => ({ data })); }

  /** W2848–W2851 "New zone (checker)" · W2852–W2854 re-point fee / deactivate / re-activate — all proposals. */
  @Post('proposals') @RequirePermissions(ZONES_MANAGE)
  propose(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(ProposeZoneSchema) dto: ProposeZoneDto) {
    return this.zones.propose(ctx.tenantId, this.actor(ctx), reqKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post('proposals/:id/confirm') @RequirePermissions(ZONES_MANAGE)
  confirm(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @Body() _b: unknown) {
    return this.zones.confirm(ctx.tenantId, this.actor(ctx), reqKey(key), id, ipOf(r)).then((data) => ({ data }));
  }
  @Post('proposals/:id/refuse') @RequirePermissions(ZONES_MANAGE)
  refuse(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(RefuseZoneProposalSchema) dto: RefuseZoneProposalDto) {
    return this.zones.refuse(ctx.tenantId, this.actor(ctx), reqKey(key), id, dto.reason, ipOf(r)).then((data) => ({ data }));
  }
  /** Name / pincodes / regions — direct, with a reason. The fee and the active state are NOT editable here (.strict() refuses them). */
  @Patch(':id') @RequirePermissions(ZONES_MANAGE)
  update(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(UpdateDeliveryZoneSchema) dto: UpdateDeliveryZoneDto) {
    return this.zones.update(ctx.tenantId, this.actor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }
}
