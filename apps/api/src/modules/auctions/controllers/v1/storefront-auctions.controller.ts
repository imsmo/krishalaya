// modules/auctions/controllers/v1/storefront-auctions.controller.ts · PC-56 STORE-2c · B7 (survey C-3 / B27) — `GET /v1/storefront/auctions/:id`,
// the ONE public read of an auction (read-models/auction-public.read-model.ts says what it returns and what it never returns).
//   • `@Public()` + rate-limited (the storefront family's 120/min/IP); the tenant is the REQUEST's context (X-Tenant-Slug / Host — the
//     TenantContextMiddleware), never a parameter; a bearer token, when present, only adds the viewer's own facts (their best bid, leading,
//     won + the order);
//   • behind the `auctions` flag (FeatureFlagGuard → 404 when OFF — the storefront reads the same flag through `storefront.flags` and shows
//     the honest "auctions are switched off" state instead of a broken page);
//   • placing a bid stays where it was: `POST /v1/auctions/:id/bids`, session-only, Idempotency-Key, the EMD held server-side.
//   • PC-56 STORE-3c · B4 (founder D4): `GET /v1/storefront/auctions?group=live|upcoming|ended&cursor&limit` — the PUBLIC LIST (same guard,
//     same flag, same rate limit; read-models/auction-public.read-model.ts `list`): keyset Next only; `?mine=1` narrows it to the session's
//     own auctions and needs a session (401 without one — never an empty "you have no bids").
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodQuery } from '../../../../core/http/zod.pipe';
import { Public } from '../../../../core/auth/public.decorator';
import { RateLimit } from '../../../../core/http/rate-limit.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { NotFoundError, UnauthorizedError } from '../../../../shared/errors/app-error';
import { AuctionPublicReadModel, PUBLIC_AUCTION_LIST_MAX } from '../../read-models/auction-public.read-model';
import { PUBLIC_AUCTION_GROUPS } from '../../repositories/auction.repository';
import { decodeCursor } from '../../domain/cursor';

export const PublicAuctionListSchema = z.object({
  group: z.enum(PUBLIC_AUCTION_GROUPS).default('live'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(PUBLIC_AUCTION_LIST_MAX).default(20),
  mine: z.enum(['1', 'true']).optional(),
}).strict();
export type PublicAuctionListDto = z.infer<typeof PublicAuctionListSchema>;

@Controller({ path: 'storefront/auctions', version: '1' })
@UseGuards(FeatureFlagGuard)
@FeatureFlag('auctions')
export class StorefrontAuctionsController {
  constructor(private readonly reads: AuctionPublicReadModel) {}

  /** The public list (declared BEFORE ':id'). */
  @Public() @RateLimit({ limit: 120, windowSec: 60, by: 'ip' }) @Get()
  async list(@CurrentContext() ctx: RequestContext, @ZodQuery(PublicAuctionListSchema) q: PublicAuctionListDto) {
    if (!ctx.tenantId) throw new NotFoundError('Not found');
    const mine = q.mine === '1' || q.mine === 'true';
    if (mine && !ctx.userId) throw new UnauthorizedError('Sign in to see the auctions you bid in');
    const page = await this.reads.list(ctx.tenantId, { group: q.group, cursor: decodeCursor(q.cursor), limit: q.limit, bidderUserId: mine ? ctx.userId : null });
    return { data: page.items, meta: { nextCursor: page.nextCursor, group: q.group } };
  }

  @Public() @RateLimit({ limit: 120, windowSec: 60, by: 'ip' }) @Get(':id')
  async get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    if (!ctx.tenantId) throw new NotFoundError('Not found');
    return { data: await this.reads.view(ctx.tenantId, id, ctx.userId || null) };
  }
}
