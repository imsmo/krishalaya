// modules/listings/controllers/sellers.controller.ts · public seller storefront profile.
// GET sellers/:id/public — SAFE public fields + rating rollup + active-listing count. NO PII.
// @Public (anonymous storefront; tenant resolved from token or X-Tenant-Id), replica-backed + RLS.
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../core/auth/permissions.guard';
import { Public } from '../../../core/auth/public.decorator';
import { CurrentContext } from '../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../core/tenancy-context/request-context';
import { SellerProfileReadModel } from '../read-models/seller-profile.read-model';
import { SellerNotFoundError } from '../domain/listing.errors';
import { OrganisationPageReadModel } from '../read-models/organisation-page.read-model';
import { StorefrontBrowseGuard } from '../storefront-browse.guard';
import { DomainError } from '../../../shared/errors/app-error';

@Controller({ path: 'sellers', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
export class SellersController {
  constructor(private readonly profiles: SellerProfileReadModel, private readonly orgPage: OrganisationPageReadModel) {}

  /** PC-56 STORE-2a · B6 — the ORGANISATION's seller page (canon W280 collapsed to the organisation, HOTFIX-4 D3): its public profile, its
   *  capped live-listing count and — only when the `reviews` flag is ON — its verified-purchase review aggregate (no identities, D1). 404 when
   *  no live organisation is in context. Behind the catalogue's kill-switch (B4). Declared BEFORE `:id/public`. */
  @Public() @Get('organisation') @UseGuards(StorefrontBrowseGuard)
  async organisation(@CurrentContext() ctx: RequestContext) {
    const data = await this.orgPage.forTenant(ctx.tenantId);
    if (!data) throw new DomainError('TENANT_NOT_FOUND', 'No organisation is served here', 404);
    return { data };
  }

  @Public() @Get(':id/public')
  async publicProfile(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    const data = await this.profiles.forSeller(ctx.tenantId, id);
    if (!data) throw new SellerNotFoundError(id);
    return { data };
  }
}
