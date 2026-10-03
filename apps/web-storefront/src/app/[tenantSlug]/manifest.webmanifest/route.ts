// apps/web-storefront/src/app/[tenantSlug]/manifest.webmanifest/route.ts · PC-56 TENANT-13d · A5 — the tenant's OWN PWA manifest.
// name / short_name / theme_color / icon come from the PUBLISHED brand; before a tenant publishes, its own name on the platform colours.
// Cached briefly (the brand changes only when two administrators publish).
import type { TenantBranding } from '@krishalaya/sdk-js';
import { publicClient } from '../../../lib/api-client';
import { env } from '../../../lib/env';
import { getTranslator } from '../../../lib/i18n';
import { tenantManifest } from '../../../features/branding/brand-theme';

export const revalidate = 60;

export async function GET(_req: Request, { params }: { params: { tenantSlug: string } }): Promise<Response> {
  const slug = params.tenantSlug;
  if (!/^[a-z0-9][a-z0-9-]{0,49}$/i.test(slug)) return new Response(null, { status: 404 });
  let b: TenantBranding | null = null;
  try { b = await publicClient(slug).lookups.tenantBranding(); } catch { b = null; }
  if (!b) return new Response(null, { status: 404 });
  const t = getTranslator();
  const m = tenantManifest(b, slug, `/${slug}`, env.publicApiUrl, t.t('storefront.metaDescription', { tenant: b.brand?.displayName || b.displayName }));
  return new Response(JSON.stringify(m), { status: 200, headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=60' } });
}
