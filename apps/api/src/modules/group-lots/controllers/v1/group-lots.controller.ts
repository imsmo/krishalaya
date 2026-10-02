// modules/group-lots/controllers/v1/group-lots.controller.ts · FPO group lots · PC-56 TENANT-11c.
// THE ONE OWNER of `/v1/group-lots` (F-3: the listings duplicate is deleted; `cross-module-route-uniqueness.spec.ts` refuses a
// second registration of any method + path). Authorisation is per lot, in the service (F-23): the route guards only resolve
// the caller; `group_lot.coordinate` / `group_lot.manage` / `group_lot.settle_approve` are judged against THIS lot. Money and
// creating routes require an Idempotency-Key (Law 3). Every act records actor, reason, before / after and ip (F-24).
// Gated by the `group_lots` feature flag.
import { Controller, Delete, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { GroupLotService } from '../../services/group-lot.service';
import {
  CancelDto, CancelSchema, CreateGroupLotDto, CreateGroupLotSchema, ExtendDto, ExtendSchema, ListLotDto, ListLotSchema, NudgeDto, OptionalNudgeSchema,
  OptionalReadySchema, OptionalSettleActSchema, PledgeDto, PledgeSchema, QueryGroupLotsDto, QueryGroupLotsSchema, ReadyDto, RefuseDto, RefuseSchema, SettleActDto,
} from '../../dto/group-lot.dto';
import { groupLotActor } from '../../policies/group-lot.policies';
import { decodeCursor } from '../../domain/cursor';

const ipOf = (req: Request) => req.ip || null;
const needKey = (key: string | undefined) => { if (!key) throw new BadRequestError('Idempotency-Key header required'); return key; };

@Controller({ path: 'group-lots', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('group_lots')
export class GroupLotsController {
  constructor(private readonly svc: GroupLotService) {}

  /** Open a lot: as its coordinator (`group_lot.coordinate`), or appoint a member (`group_lot.manage` + their consent). */
  @Post()
  create(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(CreateGroupLotSchema) dto: CreateGroupLotDto) {
    return this.svc.create(ctx.tenantId, groupLotActor(ctx), needKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }

  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryGroupLotsSchema) q: QueryGroupLotsDto) {
    return this.svc.list(ctx.tenantId, groupLotActor(ctx), { box: q.box, status: q.status, sort: q.sort, counts: q.counts === '1', cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor, counts: res.counts, total: res.total } }));
  }

  /** The cancel reasons (lookup `group_lot_cancel_reason`). Static path, declared before `:id`. */
  @Get('lookups')
  lookups(@CurrentContext() ctx: RequestContext) {
    return this.svc.cancelReasons(ctx.tenantId).then((cancelReasons) => ({ data: { cancelReasons } }));
  }

  /** A6 — progress + one's own pledge for every member; the pledge table for this lot's coordinator and tenant_admin. */
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.getById(ctx.tenantId, groupLotActor(ctx), id).then((data) => ({ data }));
  }

  /** A1 — `{ farmerUserId?, quantity }`: as self (any member), or FOR a member (this lot's coordinator / tenant_admin). */
  @Post(':id/pledges')
  pledge(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(PledgeSchema) dto: PledgeDto) {
    return this.svc.pledge(ctx.tenantId, groupLotActor(ctx), needKey(key), id, dto, ipOf(r)).then((data) => ({ data }));
  }

  /** A7 — withdraw one's own pledge until the lot lists. */
  @Delete(':id/pledges/me')
  withdraw(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) {
    return this.svc.withdraw(ctx.tenantId, groupLotActor(ctx), id, ipOf(r)).then((data) => ({ data }));
  }

  @Post(':id/ready')
  ready(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(OptionalReadySchema) dto: ReadyDto) {
    return this.svc.markReady(ctx.tenantId, groupLotActor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }

  /** A2 — ready → listed: ONE listing, the coordinator's, for the pledged quantity at `pricePerUnitMinor`. */
  @Post(':id/list')
  listLot(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(ListLotSchema) dto: ListLotDto) {
    return this.svc.listLot(ctx.tenantId, groupLotActor(ctx), needKey(key), id, dto, ipOf(r)).then((data) => ({ data }));
  }

  @Post(':id/extend')
  extend(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(ExtendSchema) dto: ExtendDto) {
    return this.svc.extend(ctx.tenantId, groupLotActor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }

  @Post(':id/nudge')
  nudge(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(OptionalNudgeSchema) dto: NudgeDto) {
    return this.svc.nudge(ctx.tenantId, groupLotActor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }

  @Post(':id/cancel')
  cancel(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(CancelSchema) dto: CancelDto) {
    return this.svc.cancel(ctx.tenantId, groupLotActor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }

  /** A3 — prepare the shares from the HELD sale proceeds (no money). */
  @Post(':id/settle/prepare')
  prepare(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) {
    return this.svc.prepare(ctx.tenantId, groupLotActor(ctx), id, ipOf(r)).then((data) => ({ data }));
  }

  /** A3 — the second person (`group_lot.settle_approve`, never the preparer or the coordinator) pays everyone in one txn. */
  @Post(':id/settle/confirm')
  confirm(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(OptionalSettleActSchema) dto: SettleActDto) {
    return this.svc.confirm(ctx.tenantId, groupLotActor(ctx), needKey(key), id, dto, ipOf(r)).then((data) => ({ data }));
  }

  @Post(':id/settle/refuse')
  refuse(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(RefuseSchema) dto: RefuseDto) {
    return this.svc.refuse(ctx.tenantId, groupLotActor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }
}
