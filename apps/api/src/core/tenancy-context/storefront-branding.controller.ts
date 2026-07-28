// core/tenancy-context/storefront-branding.controller.ts · DEV-26, Q20 (tenants.logo_url). A PUBLIC read
// (`@Public()`, mirrors `modules/lookups/controllers/v1/lookups.controller.ts`'s own convention exactly — this
// is anonymous-storefront reference data, not a business record) exposing a tenant's own white-label branding
// (display name + logo URL) for the CURRENT request's tenant context — the same `X-Tenant-Slug` → tenant-context
// resolution the anonymous storefront's listings/lookups calls already use (`TenantContextMiddleware`). Never
// more than `TenantBranding` (no PII, no internal tenant fields) — Law 12 (render only verified truth): a null
// `logoUrl` is a REAL null, never a fabricated URL, and it is the caller's job (web-storefront) to apply the
// LOGO-4 fallback, not this endpoint's.
import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { CurrentContext } from './current-context.decorator';
import { RequestContext } from './request-context';
import { TenantSlugResolver, TenantBranding } from './tenant-slug-resolver';

@Controller({ path: 'storefront', version: '1' })
export class StorefrontBrandingController {
  constructor(private readonly slugResolver: TenantSlugResolver) {}

  /** The active request's tenant branding, or `null` fields when no tenant context resolved (e.g. a platform-
   *  level page with no `X-Tenant-Slug`) or the tenant hasn't configured a logo — never a 404/500 for "no logo",
   *  since "no logo configured" is a normal, expected state (Law 12: degrade to a real absence, not an error). */
  @Public() @Get('branding')
  async branding(@CurrentContext() ctx: RequestContext): Promise<{ data: TenantBranding | null }> {
    if (!ctx.tenantId) return { data: null };
    const branding = await this.slugResolver.getBranding(ctx.tenantId);
    return { data: branding };
  }
}
