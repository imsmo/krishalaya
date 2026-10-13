// apps/web-storefront/src/app/manifest.ts · PWA web-app manifest (PC-24c), served by Next at /manifest.webmanifest.
// PC-56 TENANT-13d (A5): TENANT-AWARE. The platform's own pages get the platform's manifest (PLATFORM_BRAND — packages/tokens, the one
// brand-mark list); a request the Host middleware routed to a tenant (header `x-kv-tenant-slug`) gets THAT tenant's manifest — its
// published name, short name, primary colour and logo (or, before it publishes, its own name on the platform colours). Tenant routes
// also link their own /<slug>/manifest.webmanifest from [tenantSlug]/layout.tsx.
import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import type { TenantBranding } from '@krishalaya/sdk-js';
import { publicClient } from '../lib/api-client';
import { env } from '../lib/env';
import { platformManifest, tenantManifest } from '../features/branding/brand-theme';
import { TENANT_SLUG_HEADER } from '../lib/host-routing';
import { getTranslator } from '../lib/i18n';

// PC-56 STORE-1b · C5 (survey F-16): the description is a catalogue key (it was an English literal); the platform's manifest name is the
// platform store name from packages/tokens (founder D2 — platformManifest); a tenant's stays its own (13d).
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const PLATFORM_DESCRIPTION = getTranslator().t('meta.manifestDescription');
  const slug = headers().get(TENANT_SLUG_HEADER);
  if (slug && /^[a-z0-9][a-z0-9-]{0,49}$/i.test(slug)) {
    let b: TenantBranding | null = null;
    try { b = await publicClient(slug).lookups.tenantBranding(); } catch { b = null; }
    if (b) return tenantManifest(b, slug, '/', env.publicApiUrl, PLATFORM_DESCRIPTION) as MetadataRoute.Manifest;
  }
  return platformManifest(PLATFORM_DESCRIPTION) as MetadataRoute.Manifest;
}
