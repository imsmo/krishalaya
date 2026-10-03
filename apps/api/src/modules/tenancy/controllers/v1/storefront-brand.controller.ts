// modules/tenancy/controllers/v1/storefront-brand.controller.ts · PC-56 TENANT-13d · the two PUBLIC reads the white-label storefront needs.
//   GET /storefront/branding/logo/:tenantId/:version   the PUBLISHED logo of that version (immutable — the version is in the URL), served
//                                                        with the content-type lock (png | svg only, nosniff, an SVG sandboxed by CSP).
//                                                        Never a draft, never an unscanned file, never a suspended tenant's. 404 otherwise.
//   GET /storefront/host?host=…                          for the storefront's Host middleware: is Host routing on, which tenant a VERIFIED
//                                                        host belongs to, and whether to 301 to the tenant's primary domain (only when that
//                                                        primary is a custom domain whose certificate is issued — a 301 to an address with no
//                                                        certificate would strand every member; issuance is not built, so it is said).
// (`GET /storefront/branding` — name, logo, the published brand, Powered-by — stays in core: core/tenancy-context.)
import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../../../core/auth/public.decorator';
import { ZodQuery } from '../../../../core/http/zod.pipe';
import { FlagsService } from '../../../../core/feature-flags/flags.service';
import { AppConfig } from '../../../../core/config/app-config';
import { TenantSlugResolver } from '../../../../core/tenancy-context/tenant-slug-resolver';
import { HOST_ROUTING_FLAG } from '../../../../core/tenancy-context/tenant-context.middleware';
import { hostOnly, isPlatformHost } from '../../../../core/tenancy-context/host-routing';
import { NotFoundError } from '../../../../shared/errors/app-error';
import { TenantBrandingService } from '../../services/tenant-branding.service';
import { HostQuerySchema, HostQueryDto } from '../../dto/brand-domains.dto';
import { sendLogo } from './tenant-branding.controller';

/** Where a request on `host` should go — pure, so the 301 rule is unit-tested. */
export function hostDecision(host: string, r: { slug: string; domainKind: string; isPrimary: boolean; primaryDomain: string | null; primaryKind: string | null; primaryTls: string | null } | null) {
  if (!r) return { tenant: null, redirectTo: null as string | null, redirectBlockedBy: null as string | null };
  const primaryIsCustom = r.primaryKind === 'custom' && r.primaryDomain !== null && r.primaryDomain !== host;
  if (!r.isPrimary && primaryIsCustom) {
    if (r.primaryTls === 'issued') return { tenant: { slug: r.slug }, redirectTo: `https://${r.primaryDomain}`, redirectBlockedBy: null };
    return { tenant: { slug: r.slug }, redirectTo: null, redirectBlockedBy: 'primary_certificate_not_issued' };
  }
  return { tenant: { slug: r.slug }, redirectTo: null, redirectBlockedBy: null };
}

@Controller({ path: 'storefront', version: '1' })
export class StorefrontBrandController {
  constructor(private readonly brand: TenantBrandingService, private readonly slugs: TenantSlugResolver, private readonly flags: FlagsService,
              private readonly config: AppConfig) {}

  @Public() @Get('branding/logo/:tenantId/:version')
  async logo(@Param('tenantId') tenantId: string, @Param('version') version: string, @Res() res: Response) {
    const f = await this.brand.publicLogo(tenantId, /^\d{1,9}$/.test(version) ? Number(version) : -1);
    if (!f) throw new NotFoundError('Logo not found');
    sendLogo(res, f.bytes, f.mime, 'public, max-age=31536000, immutable');
  }

  @Public() @Get('host')
  async host(@ZodQuery(HostQuerySchema) q: HostQueryDto) {
    const routing = await this.flags.isEnabled(HOST_ROUTING_FLAG).catch(() => false);
    const host = hostOnly(q.host);
    if (!routing) return { data: { routing: false, platformHost: true, tenant: null, redirectTo: null, redirectBlockedBy: null } };
    if (isPlatformHost(host, this.config.platformHosts)) return { data: { routing: true, platformHost: true, tenant: null, redirectTo: null, redirectBlockedBy: null } };
    const r = await this.slugs.resolveHost(host);
    return { data: { routing: true, platformHost: false, unavailable: r.error, ...hostDecision(host, r.value) } };
  }
}
