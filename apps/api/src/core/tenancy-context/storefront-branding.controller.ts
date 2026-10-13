// core/tenancy-context/storefront-branding.controller.ts · DEV-26, Q20 (tenants.logo_url). A PUBLIC read
// (`@Public()`, mirrors `modules/lookups/controllers/v1/lookups.controller.ts`'s own convention exactly — this
// is anonymous-storefront reference data, not a business record) exposing a tenant's own white-label branding
// (display name + logo URL) for the CURRENT request's tenant context — the same `X-Tenant-Slug` → tenant-context
// resolution the anonymous storefront's listings/lookups calls already use (`TenantContextMiddleware`). Never
// more than `TenantBranding` (no PII, no internal tenant fields) — Law 12 (render only verified truth): a null
// `logoUrl` is a REAL null, never a fabricated URL, and it is the caller's job (web-storefront) to apply the
// LOGO-4 fallback, not this endpoint's.
import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { DomainError } from '../../shared/errors/app-error';
import { PHONE_DEFAULT_COUNTRY } from '../../shared/utils/phone';
import { FlagsService } from '../feature-flags/flags.service';
import { HOST_ROUTING_FLAG } from './tenant-context.middleware';
import { hostOnly } from './host-routing';
import { CurrentContext } from './current-context.decorator';
import { RequestContext } from './request-context';
import { TenantSlugResolver, TenantBranding } from './tenant-slug-resolver';

@Controller({ path: 'storefront', version: '1' })
export class StorefrontBrandingController {
  constructor(private readonly slugResolver: TenantSlugResolver, private readonly flags: FlagsService) {}

  /** The active request's tenant branding, or `null` fields when no tenant context resolved (e.g. a platform-
   *  level page with no `X-Tenant-Slug`) or the tenant hasn't configured a logo — never a 404/500 for "no logo",
   *  since "no logo configured" is a normal, expected state (Law 12: degrade to a real absence, not an error). */
  @Public() @Get('branding')
  async branding(@CurrentContext() ctx: RequestContext): Promise<{ data: TenantBranding | null }> {
    if (!ctx.tenantId) return { data: null };
    const branding = await this.slugResolver.getBranding(ctx.tenantId);
    return { data: branding };
  }

  /**
   * PC-56 STORE-1a · A3 (founder D1) — "which organisation is this storefront page?", for the anonymous storefront: the LIVE tenant the
   * request's context resolved (X-Tenant-Slug → `resolve_tenant_slug`, a verified host → `resolve_tenant_host`, an X-Tenant-Id →
   * `resolve_live_tenant` — all 0200/0194 SECURITY DEFINER reads; `tenants` is never read here as kv_app). 404 TENANT_NOT_FOUND when
   * nothing live resolved — never a default tenant. The storefront signs a buyer in to THIS id.
   *
   * `countryCode` / `defaultLang` are NULL on purpose: no SECURITY DEFINER read exposes them yet (`public_tenant_card` returns a name
   * and a logo only) and STORE-1a adds no migration — a fix-forward migration extending the card is owed. `phoneDefaultCountry` is the
   * country a bare national number is read as by the API's own normaliser — server truth the sign-in screen can state.
   */
  @Public() @Get('tenant')
  async tenant(@CurrentContext() ctx: RequestContext, @Req() req: Request): Promise<{ data: StorefrontTenant }> {
    if (!ctx.tenantId) throw new DomainError('TENANT_NOT_FOUND', 'No organisation is served here', 404);
    const branding = await this.slugResolver.getBranding(ctx.tenantId);
    if (!branding) throw new DomainError('TENANT_NOT_FOUND', 'No organisation is served here', 404);
    return { data: { tenantId: ctx.tenantId, slug: await this.slugOf(req, ctx.tenantId), displayName: branding.displayName, countryCode: null, defaultLang: null, phoneDefaultCountry: PHONE_DEFAULT_COUNTRY } };
  }

  /** The public slug of the resolved tenant, from the same (cached) resolutions the middleware used; null when it came by id only. */
  private async slugOf(req: Request, tenantId: string): Promise<string | null> {
    const header = String(req.headers['x-tenant-slug'] ?? '').trim().toLowerCase();
    if (header && (await this.slugResolver.resolve(header)) === tenantId) return header;
    let hostRouting = false;
    try { hostRouting = await this.flags.isEnabled(HOST_ROUTING_FLAG); } catch { hostRouting = false; }
    if (hostRouting) {
      const host = hostOnly((req as Request & { hostname?: string }).hostname || String(req.headers.host ?? ''));
      const r = host ? await this.slugResolver.resolveHost(host) : { value: null };
      if (r.value && r.value.tenantId === tenantId) return r.value.slug;
    }
    return null;
  }
}

/** PC-56 STORE-1a · A3: the storefront's resolved tenant — no PII, no internal tenant fields. */
export interface StorefrontTenant {
  tenantId: string; slug: string | null; displayName: string;
  countryCode: string | null; defaultLang: string | null; phoneDefaultCountry: string;
}
