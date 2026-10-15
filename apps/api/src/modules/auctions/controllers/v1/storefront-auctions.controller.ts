// modules/auctions/controllers/v1/storefront-auctions.controller.ts · PC-56 STORE-2c · B7 (survey C-3 / B27) — `GET /v1/storefront/auctions/:id`,
// the ONE public read of an auction (read-models/auction-public.read-model.ts says what it returns and what it never returns).
//   • `@Public()` + rate-limited (the storefront family's 120/min/IP); the tenant is the REQUEST's context (X-Tenant-Slug / Host — the
//     TenantContextMiddleware), never a parameter; a bearer token, when present, only adds the viewer's own facts (their best bid, leading,
//     won + the order);
//   • behind the `auctions` flag (FeatureFlagGuard → 404 when OFF — the storefront reads the same flag through `storefront.flags` and shows
//     the honest "auctions are switched off" state instead of a broken page);
//   • placing a bid stays where it was: `POST /v1/auctions/:id/bids`, session-only, Idempotency-Key, the EMD held server-side.
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Public } from '../../../../core/auth/public.decorator';
import { RateLimit } from '../../../../core/http/rate-limit.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { NotFoundError } from '../../../../shared/errors/app-error';
import { AuctionPublicReadModel } from '../../read-models/auction-public.read-model';

@Controller({ path: 'storefront/auctions', version: '1' })
@UseGuards(FeatureFlagGuard)
@FeatureFlag('auctions')
export class StorefrontAuctionsController {
  constructor(private readonly reads: AuctionPublicReadModel) {}

  @Public() @RateLimit({ limit: 120, windowSec: 60, by: 'ip' }) @Get(':id')
  async get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    if (!ctx.tenantId) throw new NotFoundError('Not found');
    return { data: await this.reads.view(ctx.tenantId, id, ctx.userId || null) };
  }
}
