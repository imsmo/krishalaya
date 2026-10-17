// apps/web-storefront/src/app/[tenantSlug]/manifest.webmanifest/route.ts · PC-56 TENANT-13d · A5 — the tenant's OWN PWA manifest.
// name / short_name / theme_color / icon come from the PUBLISHED brand; before a tenant publishes, its own name on the platform colours.
// Cached briefly (the brand changes only when two administrators publish).
// PC-56 STORE-6a · D6 (founder Q6, survey F-5): ONE manifest per store — on the store's OWN host (the middleware rewrote the host-root
// `/manifest.webmanifest` here and named the organisation in `x-kv-tenant-slug`) `start_url`/`scope`/`id` are `/`; on a path store `/<slug>`.
// The icons are the organisation's only (its logo, else its generated monogram — never the platform's); the description names the
// organisation alone (`store6.manifest.description`, no `{platform}`); `lang` / `dir` are the person's language at install.
import type { TenantBranding } from '@krishalaya/sdk-js';
import { publicClient } from '../../../lib/api-client';
import { env } from '../../../lib/env';
import { getLanguageDef, getTranslator } from '../../../lib/i18n';
import { TENANT_SLUG_HEADER } from '../../../lib/host-routing';
import { tenantManifest } from '../../../features/branding/brand-theme';

export const revalidate = 60;

export async function GET(req: Request, { params }: { params: { tenantSlug: string } }): Promise<Response> {
  const slug = params.tenantSlug;
  if (!/^[a-z0-9][a-z0-9-]{0,49}$/i.test(slug)) return new Response(null, { status: 404 });
  let b: TenantBranding | null = null;
  try { b = await publicClient(slug).lookups.tenantBranding(); } catch { b = null; }
  if (!b) return new Response(null, { status: 404 });
  const t = getTranslator();
  const l = getLanguageDef();
  const onOwnHost = req.headers.get(TENANT_SLUG_HEADER) === slug;
  const m = tenantManifest(b, slug, onOwnHost ? '/' : `/${slug}`, env.publicApiUrl, t.t('store6.manifest.description', { tenant: b.brand?.displayName || b.displayName }),
    { lang: l.code, dir: l.dir === 'rtl' ? 'rtl' : 'ltr' });
  return new Response(JSON.stringify(m), { status: 200, headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=60', vary: 'Cookie' } });
}
