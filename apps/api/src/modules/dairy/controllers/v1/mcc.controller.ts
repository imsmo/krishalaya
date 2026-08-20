// modules/dairy/controllers/v1/mcc.controller.ts · MCC centre admin + memberships (cooperative-operator).
// create/setActive/enrol need dairy.manage; browse is any authenticated tenant user. `dairy` flag.
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { MccCentreService } from '../../services/mcc-centre.service';
import { DairyMembershipService } from '../../services/dairy-membership.service';
import { CreateMccSchema, CreateMccDto } from '../../dto/create-mcc-centre.dto';
import { SetMccActiveSchema, SetMccActiveDto } from '../../dto/update-mcc-centre.dto';
import { QueryMccSchema, QueryMccDto } from '../../dto/query-mcc-centre.dto';
import { CreateMembershipSchema, CreateMembershipDto } from '../../dto/create-dairy-membership.dto';
import { QueryMembershipsSchema, QueryMembershipsDto } from '../../dto/query-dairy-membership.dto';
import { DairyPermissions, canManageDairy, canCloseSettlement } from '../../policies/dairy.policies';

const ipOf = (r: Request) => r.ip || null;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'dairy/mccs', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('dairy')
export class MccController {
  constructor(private readonly mccs: MccCentreService, private readonly memberships: DairyMembershipService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageDairy(ctx), canCloseSettlement: canCloseSettlement(ctx) }; }

  @Post() @RequirePermissions(DairyPermissions.Manage)
  create(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(CreateMccSchema) dto: CreateMccDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.mccs.create(ctx.tenantId, this.actor(ctx), key, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryMccSchema) q: QueryMccDto) {
    return this.mccs.list(ctx.tenantId, { activeOnly: q.activeOnly, cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.mccs.getById(ctx.tenantId, id).then((data) => ({ data })); }
  @Post(':id/active') @RequirePermissions(DairyPermissions.Manage)
  setActive(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(SetMccActiveSchema) dto: SetMccActiveDto) {
    return this.mccs.setActive(ctx.tenantId, this.actor(ctx), id, dto.isActive, ipOf(r)).then((data) => ({ data }));
  }

  // memberships (farmer ↔ MCC) live under the MCC resource
  @Post('memberships') @RequirePermissions(DairyPermissions.Manage)
  enrol(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(CreateMembershipSchema) dto: CreateMembershipDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.memberships.create(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }
  @Get('memberships/list')
  listMemberships(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryMembershipsSchema) q: QueryMembershipsDto) {
    return this.memberships.list(ctx.tenantId, this.actor(ctx), { box: q.box, mccId: q.mccId, cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get('memberships/:id')
  getMembership(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.memberships.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
}
