// modules/auctions/controllers/v1/auctions.controller.ts · auction lifecycle (validate→authorize→delegate). Gated by `auctions`.
//
// PC-56 TENANT-11a (F-10): who may do what is the auction desk's verbs, not moderation reach —
//   • POST /auctions — auction.create (the seller) OR auction.schedule_on_behalf (staff, for a seller, with consent);
//   • POST /:id/approve — the seller, or staff with auction.schedule_on_behalf + the seller's consent (service). Idempotency-Key;
//   • POST /:id/cancel — reason mandatory: the seller while scheduled, the seller's DECLINE while awaiting approval (or
//     staff with consent), tenant_admin (auction.cancel_live) while live;
//   • POST /:id/pause-entry · /:id/resume-entry — auction.pause_entry (tenant_admin), reason;
//   • reads: the list and the detail are open to every member (the reserve only to the seller and the desk, F-27a).
// Every non-GET route here is refused for the auditor by the global AuditorReadOnlyGuard.
import { Controller, Delete, Get, Headers, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { AuctionService } from '../../services/auction.service';
import { AuctionWatcherService } from '../../services/auction-watcher.service';
import { MyBidsReadModel } from '../../read-models/my-bids.read-model';
import { CreateAuctionSchema, CreateAuctionDto } from '../../dto/create-auction.dto';
import { UpdateAuctionSchema, UpdateAuctionDto } from '../../dto/update-auction.dto';
import { QueryAuctionsSchema, QueryAuctionsDto } from '../../dto/query-auction.dto';
import { QueryAuctionWatchersSchema, QueryAuctionWatchersDto } from '../../dto/query-auction-watcher.dto';
import { ApproveAuctionSchema, ApproveAuctionDto, CancelAuctionSchema, CancelAuctionDto, EntryActSchema, EntryActDto } from '../../dto/auction-act.dto';
import { AuctionPermissions, auctionActor, auctionViewer, canSchedule } from '../../policies/auctions.policies';
import { AuctionForbiddenError } from '../../domain/auctions.errors';
import { decodeCursor } from '../../domain/cursor';

const ipOf = (req: Request) => req.ip || null;

@Controller({ path: 'auctions', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('auctions')
export class AuctionsController {
  constructor(private readonly auctions: AuctionService, private readonly watchers: AuctionWatcherService, private readonly myBids: MyBidsReadModel) {}

  @Post()
  create(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(CreateAuctionSchema) dto: CreateAuctionDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    if (!canSchedule(ctx)) throw new AuctionForbiddenError('scheduling an auction needs auction.create (the seller) or auction.schedule_on_behalf (the desk)');
    return this.auctions.create(ctx.tenantId, auctionActor(ctx), key, dto, ipOf(r)).then((data) => ({ data }));
  }

  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryAuctionsSchema) q: QueryAuctionsDto) {
    return this.auctions.list(ctx.tenantId, { status: q.status, group: q.group, cursor: decodeCursor(q.cursor), limit: q.limit }, auctionViewer(ctx))
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor, counts: res.counts, total: res.total } }));
  }

  // static routes declared BEFORE ':id' so 'watching'/'my-bids' aren't captured as an auction id
  @Get('watching')
  watching(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryAuctionWatchersSchema) q: QueryAuctionWatchersDto) {
    return this.watchers.listMine(ctx.tenantId, ctx.userId, { cursor: q.cursor, limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  /** The caller's OWN bids across ALL auctions (keyset), each with its EMD hold + winning flag. */
  @Get('my-bids')
  myBidsList(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryAuctionWatchersSchema) q: QueryAuctionWatchersDto) {
    return this.myBids.forBidder(ctx.tenantId, ctx.userId, { cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  @Get(':id/watch')
  isWatching(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.watchers.isWatching(ctx.tenantId, ctx.userId, id).then((data) => ({ data })); }

  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.auctions.getById(ctx.tenantId, id, auctionViewer(ctx)).then((data) => ({ data })); }

  /** Seller (or the desk scheduling for them) edits a SCHEDULED auction's terms. */
  @Patch(':id')
  update(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(UpdateAuctionSchema) dto: UpdateAuctionDto) {
    if (!canSchedule(ctx)) throw new AuctionForbiddenError();
    return this.auctions.updateScheduled(ctx.tenantId, auctionActor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }

  // watch-list: any authed member may watch an auction in their tenant (idempotent)
  @Post(':id/watch')
  watch(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.watchers.watch(ctx.tenantId, ctx.userId, id).then((data) => ({ data })); }
  @Delete(':id/watch')
  unwatch(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.watchers.unwatch(ctx.tenantId, ctx.userId, id).then((data) => ({ data })); }

  /** W139 "Approve — create order". Idempotent (double-click safe). */
  @Post(':id/approve')
  approve(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(ApproveAuctionSchema) dto: ApproveAuctionDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.auctions.approve(ctx.tenantId, auctionActor(ctx), id, key, dto.consent ?? null, ipOf(r)).then((data) => ({ data }));
  }

  /** Cancel (scheduled / live) or the seller's decline (awaiting approval). Reason mandatory. */
  @Post(':id/cancel')
  cancel(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(CancelAuctionSchema) dto: CancelAuctionDto) {
    return this.auctions.cancel(ctx.tenantId, auctionActor(ctx), id, dto.reason, dto.consent ?? null, ipOf(r)).then((data) => ({ data }));
  }

  /** A11: stop NEW bidders entering a live auction (existing bidders continue). */
  @Post(':id/pause-entry') @RequirePermissions(AuctionPermissions.PauseEntry)
  pauseEntry(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(EntryActSchema) dto: EntryActDto) {
    return this.auctions.setEntryPaused(ctx.tenantId, auctionActor(ctx), id, true, dto.reason, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/resume-entry') @RequirePermissions(AuctionPermissions.PauseEntry)
  resumeEntry(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(EntryActSchema) dto: EntryActDto) {
    return this.auctions.setEntryPaused(ctx.tenantId, auctionActor(ctx), id, false, dto.reason, ipOf(r)).then((data) => ({ data }));
  }
}
