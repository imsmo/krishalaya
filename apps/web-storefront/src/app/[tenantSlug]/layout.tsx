// apps/web-storefront/src/app/[tenantSlug]/layout.tsx · PC-56 TENANT-13d · A5 — THE TENANT'S OWN STOREFRONT, BRANDED.
// Every route under /<tenantSlug> (and every Host-routed request the middleware rewrites here) gets, from the PUBLISHED brand:
//   • metadata: title = the tenant's display name, the tenant's own manifest (/<slug>/manifest.webmanifest), the app short name for iOS,
//     the published logo as the icon; viewport theme_color = the tenant's primary;
//   • the four colours as CSS variables on :root (re-validated in brand-theme.ts — nothing that is not #rrggbb reaches the stylesheet);
//   • the one-time "same organisation, new look" note (BrandChangeNote, a cookie per tenant);
//   • the small "Powered by Krishalaya" mark — unless the tenant chose to hide it AND its plan allows it right now.
// Before a tenant publishes, its storefront shows ITS NAME on the platform colours — never the platform's own store name.
import type { Metadata, Viewport } from 'next';
import type { TenantBranding } from '@krishalaya/sdk-js';
import { publicClient } from '../../lib/api-client';
import { env } from '../../lib/env';
import { getTranslator } from '../../lib/i18n';
import { brandCss, brandColours, logoSrc, poweredByVisible, PLATFORM_BRAND } from '../../features/branding/brand-theme';
import { BrandChangeNote } from '../../components/BrandChangeNote';
import { PoweredByMark } from '../../components/PoweredByMark';

async function loadBranding(slug: string): Promise<TenantBranding | null> {
  try { return await publicClient(slug).lookups.tenantBranding(); } catch { return null; }
}

export async function generateMetadata({ params }: { params: { tenantSlug: string } }): Promise<Metadata> {
  const b = await loadBranding(params.tenantSlug);
  const name = (b?.brand?.displayName || b?.displayName || params.tenantSlug).trim();
  const logo = logoSrc(env.publicApiUrl, b?.brand);
  return {
    title: { default: name, template: `%s · ${name}` },
    applicationName: name,
    manifest: `/${params.tenantSlug}/manifest.webmanifest`,
    appleWebApp: { capable: true, statusBarStyle: 'default', title: (b?.brand?.appShortName || name).slice(0, 12) },
    ...(logo ? { icons: { icon: [{ url: logo, type: b!.brand!.logoMime }], apple: logo } } : {}),
  };
}

export async function generateViewport({ params }: { params: { tenantSlug: string } }): Promise<Viewport> {
  const b = await loadBranding(params.tenantSlug);
  return { themeColor: brandColours(b?.brand)?.primary ?? '#1e6f3f' };
}

export default async function TenantLayout({ children, params }: { children: React.ReactNode; params: { tenantSlug: string } }) {
  const b = await loadBranding(params.tenantSlug);
  const css = brandCss(b?.brand);
  const t = getTranslator();
  const name = (b?.brand?.displayName || b?.displayName || params.tenantSlug).trim();
  return (
    <>
      {css && <style data-kv-tenant-brand={String(b!.brand!.version)} dangerouslySetInnerHTML={{ __html: css }} />}
      {b?.brand && <BrandChangeNote tenantSlug={params.tenantSlug} version={b.brand.version}
        title={t.t('brand.note.title')} body={t.t('brand.note.body', { name })} dismiss={t.t('brand.note.dismiss')} />}
      {children}
      {poweredByVisible('storefront', b?.brand) && <PoweredByMark label={PLATFORM_BRAND.poweredByMark} />}
    </>
  );
}
