// apps/web-storefront/src/app/(platform)/manifest.webmanifest/route.ts · the host-root PWA manifest, `/manifest.webmanifest` (PC-24c; tenant-aware
// since PC-56 TENANT-13d). The platform's own pages get the platform's manifest (PLATFORM_BRAND — packages/tokens, the one brand-mark list); a
// request the Host middleware routed to a tenant (header `x-kv-tenant-slug`) gets THAT tenant's manifest. (On a store's own host the middleware
// rewrites `/manifest.webmanifest` to the tenant route, so this branch is the fallback for a routed host the rewrite did not reach.)
// PC-56 STORE-1b · C5 (survey F-16): the description is a catalogue key; the platform's manifest name is the platform store name (founder D2).
//
// PC-56 STORE-6a · D6 (found by the `next start` probe): this was `app/manifest.ts` — Next's manifest FILE convention, whose
// `<link rel="manifest">` OVERRIDES every layout's `metadata.manifest`. So a PATH store (`/<slug>` on the platform host) linked the PLATFORM's
// manifest, and installing an organisation's store installed the platform (survey F-5, white-label). It is now a plain route at the same URL
// (inside the `(platform)` group — a route group adds no segment, and at the app root Next would treat a `manifest.webmanifest` folder as
// its metadata convention again), linked by the ROOT layout's metadata, which the organisation's layout overrides with its own (one manifest
// per store: `/<slug>/manifest.webmanifest` on a path store, this URL on its own host). + `id`, `lang`, `dir`; a tenant's description is the
// organisation's own sentence (`store6.manifest.description`, no `{platform}`); its icons are the organisation's only.
import type { TenantBranding } from '@krishalaya/sdk-js';
import { publicClient } from '../../../lib/api-client';
import { env } from '../../../lib/env';
import { platformManifest, tenantManifest } from '../../../features/branding/brand-theme';
import { TENANT_SLUG_HEADER } from '../../../lib/host-routing';
import { getLanguageDef, getTranslator } from '../../../lib/i18n';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const t = getTranslator();
  const l = getLanguageDef();
  const locale = { lang: l.code, dir: l.dir === 'rtl' ? 'rtl' as const : 'ltr' as const };
  const slug = req.headers.get(TENANT_SLUG_HEADER);
  let body: unknown = null;
  if (slug && /^[a-z0-9][a-z0-9-]{0,49}$/i.test(slug)) {
    let b: TenantBranding | null = null;
    try { b = await publicClient(slug).lookups.tenantBranding(); } catch { b = null; }
    if (b) body = tenantManifest(b, slug, '/', env.publicApiUrl, t.t('store6.manifest.description', { tenant: b.brand?.displayName || b.displayName }), locale);
  }
  body = body ?? platformManifest(t.t('meta.manifestDescription'), locale);
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=60', vary: 'Cookie' } });
}
