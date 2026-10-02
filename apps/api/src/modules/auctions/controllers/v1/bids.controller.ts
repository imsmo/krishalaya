// modules/auctions/controllers/v1/bids.controller.ts · place + list bids. Bidding needs auction.bid
// + an Idempotency-Key (it moves money — the EMD hold). Gated by the `auctions` flag. Bidding is a
// critical path: throttled at the edge by the global rate-limit guard.
// PC-56 TENANT-11a (F-17): reading the bid stream needs auction.bid or auction.read, and it is MASKED (B1…Bn) — raw
// bidder ids never leave the API; the seller and the auction desk see the masked phone + short name only after close.
import { Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { BidService } from '../../services/bid.service';
import { AuctionLiveReadModel } from '../../read-models/auction-live.read-model';
import { CreateBidSchema, CreateBidDto } from '../../dto/create-bid.dto';
import { AuctionPermissions, auctionViewer, canReadBids } from '../../policies/auctions.policies';
import { AuctionReadForbiddenError } from '../../domain/auctions.errors';
import { decodeCursor } from '../../domain/cursor';

const ipOf = (req: Request) => req.ip || null;

@Controller({ path: 'auctions/:auctionId/bids', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('auctions')
export class BidsController {
  constructor(private readonly bids: BidService, private readonly live: AuctionLiveReadModel) {}

  @Post() @RequirePermissions(AuctionPermissions.Bid)
  place(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('auctionId') auctionId: string, @Headers('idempotency-key') key: string, @ZodBody(CreateBidSchema) dto: CreateBidDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.bids.placeBid(ctx.tenantId, ctx.userId, auctionId, key, dto.amountMinor, ipOf(r)).then((data) => ({ data }));
  }

  @Get()
  list(@CurrentContext() ctx: RequestContext, @Param('auctionId') auctionId: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    if (!canReadBids(ctx)) throw new AuctionReadForbiddenError();
    const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return this.live.bidHistory(ctx.tenantId, auctionViewer(ctx), auctionId, { cursor: decodeCursor(cursor), limit: lim }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor, ...res.meta } }));
  }
}
