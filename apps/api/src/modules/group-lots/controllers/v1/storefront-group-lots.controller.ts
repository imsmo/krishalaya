// modules/group-lots/controllers/v1/storefront-group-lots.controller.ts · PC-56 STORE-3c · B8 (founder D3, survey B22) — `GET
// /v1/storefront/group-lots/:id`, THE ONE PUBLIC READ OF A GROUP LOT (GroupLotService.publicView says what it returns and what it never
// returns: no pledger identity, no coordinator id or name — a COUNT, the organisation, the server's progress in basis points).
//   • `@Public()` + rate-limited (the storefront family's 120/min/IP); the tenant is the REQUEST's context (X-Tenant-Slug / Host — the
//     TenantContextMiddleware), never a parameter; RLS applies to every read;
//   • behind the `group_lots` flag (FeatureFlagGuard → 404 when OFF — the storefront reads the same flag through `storefront.flags` and prints
//     the honest "this organisation does not run group lots" state);
//   • pledging stays a MEMBER's act (`POST /v1/group-lots/:id/pledges`); "register interest" is refused by name (founder D3) — no route.
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Public } from '../../../../core/auth/public.decorator';
import { RateLimit } from '../../../../core/http/rate-limit.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { NotFoundError } from '../../../../shared/errors/app-error';
import { GroupLotService } from '../../services/group-lot.service';

@Controller({ path: 'storefront/group-lots', version: '1' })
@UseGuards(FeatureFlagGuard)
@FeatureFlag('group_lots')
export class StorefrontGroupLotsController {
  constructor(private readonly lots: GroupLotService) {}

  @Public() @RateLimit({ limit: 120, windowSec: 60, by: 'ip' }) @Get(':id')
  async get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    if (!ctx.tenantId) throw new NotFoundError('Not found');
    return { data: await this.lots.publicView(ctx.tenantId, id) };
  }
}
