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
import {
  QueryMccConsoleSchema, QueryMccConsoleDto, AssignMccOperatorSchema, AssignMccOperatorDto,
  ReleaseMccOperatorSchema, ReleaseMccOperatorDto, SetMccShiftWindowSchema, SetMccShiftWindowDto,
  QueryMccCustodySchema, QueryMccCustodyDto,
} from '../../dto/mcc-console.dto';
import { DairyCentresReadModel, CENTRES_CONSOLE_FLAG } from '../../read-models/dairy-centres.read-model';
import { DairyMembershipMoveService, MEMBERSHIP_TRANSFER_FLAG } from '../../services/dairy-membership-move.service';
import {
  MoveMembershipSchema, MoveMembershipDto, PreviewMoveSchema, PreviewMoveDto,
  QueryRouteTrailSchema, QueryRouteTrailDto,
} from '../../dto/membership-move.dto';
import { MilkShift } from '../../domain/mcc-console';
import { DairyPermissions, canManageDairy, canCloseSettlement } from '../../policies/dairy.policies';

const ipOf = (r: Request) => r.ip || null;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'dairy/mccs', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('dairy')
export class MccController {
  constructor(
    private readonly mccs: MccCentreService,
    private readonly memberships: DairyMembershipService,
    private readonly centres: DairyCentresReadModel,
    private readonly moves: DairyMembershipMoveService,
  ) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageDairy(ctx), canCloseSettlement: canCloseSettlement(ctx) }; }

  @Post() @RequirePermissions(DairyPermissions.Manage)
  create(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(CreateMccSchema) dto: CreateMccDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.mccs.create(ctx.tenantId, this.actor(ctx), key, dto, ipOf(r)).then((data) => ({ data }));
  }
  /**
   * W171 itself. **DECLARED BEFORE `@Get(':id')`** — Nest matches in declaration order and the parameterised route
   * would otherwise answer the board with *"MCC centre 'console' not found"*. Third sighting of that trap in this
   * programme (TENANT-6c-6's cycle console, TENANT-6d-1's monitor), asserted the same way in the spec.
   *
   * Behind BOTH the module flag (on the controller) and `dairy_centres_console` — which is now a real AND rather than
   * the screen flag cancelling the module's, see `core/feature-flags/flags.guard.ts`.
   */
  @Get('console') @RequirePermissions(DairyPermissions.Manage) @FeatureFlag(CENTRES_CONSOLE_FLAG)
  console(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryMccConsoleSchema) q: QueryMccConsoleDto) {
    return this.centres.view(ctx.tenantId, this.actor(ctx), { includeInactive: q.includeInactive, limit: q.limit }).then((data) => ({ data }));
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

  /**
   * W171: *"operator assignment is recorded (custody of member milk)"*.
   *
   * IDEMPOTENCY-KEY REQUIRED. Not because money moves, but because a handover retried on a dropped village connection
   * would otherwise close the custody it had just opened and open a third — and a custody register with a phantom
   * two-second tenure in it cannot answer the question it exists for.
   */
  @Post(':id/operator') @RequirePermissions(DairyPermissions.Manage) @FeatureFlag(CENTRES_CONSOLE_FLAG)
  assignOperator(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string,
                 @Headers('idempotency-key') key: string, @ZodBody(AssignMccOperatorSchema) dto: AssignMccOperatorDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.mccs.assignOperator(ctx.tenantId, this.actor(ctx), key, id, { operatorUserId: dto.operatorUserId, reason: dto.reason ?? null }, ipOf(r)).then((data) => ({ data }));
  }

  /** Nobody holds the centre. No idempotency key: releasing twice is refused by the aggregate, not silently repeated. */
  @Post(':id/operator/release') @RequirePermissions(DairyPermissions.Manage) @FeatureFlag(CENTRES_CONSOLE_FLAG)
  releaseOperator(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(ReleaseMccOperatorSchema) dto: ReleaseMccOperatorDto) {
    return this.mccs.releaseOperator(ctx.tenantId, this.actor(ctx), id, dto.reason ?? null, ipOf(r)).then((data) => ({ data }));
  }

  /** The hours TENANT-6a refused to invent. Omitting `opens`/`closes` CLEARS the shift and restores that refusal. */
  @Post(':id/shift-window') @RequirePermissions(DairyPermissions.Manage) @FeatureFlag(CENTRES_CONSOLE_FLAG)
  setShiftWindow(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(SetMccShiftWindowSchema) dto: SetMccShiftWindowDto) {
    const window = dto.opens !== undefined && dto.closes !== undefined ? { opens: dto.opens, closes: dto.closes } : null;
    return this.mccs.setShiftWindow(ctx.tenantId, this.actor(ctx), id, dto.shift as MilkShift, window, ipOf(r)).then((data) => ({ data }));
  }

  /** Who has held this centre. Behind `dairy.manage`: a custody register names staff and how long each one served. */
  @Get(':id/custody') @RequirePermissions(DairyPermissions.Manage) @FeatureFlag(CENTRES_CONSOLE_FLAG)
  custody(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodQuery(QueryMccCustodySchema) q: QueryMccCustodyDto) {
    return this.mccs.custodyHistory(ctx.tenantId, this.actor(ctx), id, q.limit).then((data) => ({ data }));
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
  /**
   * W171: *"Moving house? The membership moves centres without losing history."*
   *
   * BOTH LITERAL ROUTES ARE DECLARED BEFORE `memberships/:id`, for the trap this programme has now hit four times:
   * Nest matches in declaration order, and `memberships/:id` would answer the trail with *"membership 'route' not
   * found"*. Asserted by reflection in the spec, not by hoping.
   */
  @Post('memberships/:id/move') @RequirePermissions(DairyPermissions.Manage) @FeatureFlag(MEMBERSHIP_TRANSFER_FLAG)
  moveMembership(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string,
                 @Headers('idempotency-key') key: string, @ZodBody(MoveMembershipSchema) dto: MoveMembershipDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.moves.move(ctx.tenantId, this.actor(ctx), key, id, dto, ipOf(r)).then((data) => ({ data }));
  }

  /**
   * Can it move, and from when — without moving it.
   *
   * A POST because it carries a body (the destination, the card and the date are all part of the question), and
   * because a GET whose answer depends on a proposed card would be a cache key nobody wants. It writes nothing.
   */
  @Post('memberships/:id/move/preview') @RequirePermissions(DairyPermissions.Manage) @FeatureFlag(MEMBERSHIP_TRANSFER_FLAG)
  previewMove(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(PreviewMoveSchema) dto: PreviewMoveDto) {
    return this.moves.preview(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data }));
  }

  /**
   * Everywhere a membership has poured, oldest first.
   *
   * NOT behind the transfer flag: a route history exists from migration 0164 whether or not anybody may move a
   * membership, and hiding a member's own record behind the flag that governs a staff action would make the flag a
   * data-visibility switch. Authorised by OWNERSHIP — a member may read their own trail.
   */
  @Get('memberships/:id/route')
  routeTrail(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodQuery(QueryRouteTrailSchema) q: QueryRouteTrailDto) {
    return this.moves.trail(ctx.tenantId, this.actor(ctx), id, q.limit).then((data) => ({ data }));
  }

  @Get('memberships/:id')
  getMembership(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.memberships.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
}
