// apps/web-storefront/src/app/[tenantSlug]/layout.tsx · PC-56 TENANT-13d · A5 — THE TENANT'S OWN STOREFRONT, BRANDED.
// Every route under /<tenantSlug> (and every Host-routed request the middleware rewrites here) gets, from the PUBLISHED brand:
//   • metadata: title = the tenant's display name, the tenant's own manifest (/<slug>/manifest.webmanifest), the app short name for iOS,
//     the published logo as the icon; viewport theme_color = the tenant's primary;
//   • the four colours as CSS variables on :root (re-validated in brand-theme.ts — nothing that is not #rrggbb reaches the stylesheet);
//   • the one-time "same organisation, new look" note (BrandChangeNote, a cookie per tenant);
//   • the small "Powered by Krishalaya" mark — unless the tenant chose to hide it AND its plan allows it right now.
// Before a tenant publishes, its storefront shows ITS NAME on the platform colours — never the platform's own store name.
//
// PC-56 STORE-1b · C1/C3:
//   • THE TENANT'S OWN CHROME: TenantHeader (logo/name → /<slug>, "Powered by Krishalaya" IN THE HEADER per canon W274 + the 13d rule,
//     the breadcrumb back to the platform store) and TenantFooter (organisation, Help, the mark) — the platform SiteHeader no longer wraps
//     a tenant store (survey F-6), and the canon's platform footer on W274 is a DELTA, not copied;
//   • A REAL 404 (survey F-4): an unknown, non-live or — to an anonymous visitor — TRIAL organisation (founder D4; the API answers 404
//     TENANT_NOT_FOUND) is `notFound()` HERE, so no page under it can render a fabricated "<slug> storefront";
//   • AN OUTAGE IS NOT A 404: a branding/tenant read that fails any other way renders the store DEGRADED (the slug as its name, a sentence
//     saying the details could not be reached) — never a false "this store does not exist";
//   • one read per request (lib/storefront-data.ts, React `cache`) shared by metadata, viewport and the layout (survey F-22).
import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { env } from '../../lib/env';
import { getTranslator } from '../../lib/i18n';
import { loadTenantShell } from '../../lib/storefront-data';
import { brandCss, brandColours, logoSrc, brandingForMark, poweredByVisible } from '../../features/branding/brand-theme';
import { BrandChangeNote } from '../../components/BrandChangeNote';
import { TenantHeader } from '../../components/TenantHeader';
import { TenantFooter } from '../../components/TenantFooter';

export async function generateMetadata({ params }: { params: { tenantSlug: string } }): Promise<Metadata> {
  const shell = await loadTenantShell(params.tenantSlug);
  const b = shell.kind === 'ok' ? shell.branding : null;
  const name = (b?.brand?.displayName || b?.displayName || (shell.kind === 'ok' ? shell.tenant.displayName : '') || params.tenantSlug).trim();
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
  const shell = await loadTenantShell(params.tenantSlug);
  const b = shell.kind === 'ok' ? shell.branding : null;
  return { themeColor: brandColours(b?.brand)?.primary ?? '#1e6f3f' };
}

export default async function TenantLayout({ children, params }: { children: React.ReactNode; params: { tenantSlug: string } }) {
  const shell = await loadTenantShell(params.tenantSlug);
  if (shell.kind === 'not_found') notFound();
  const t = getTranslator();
  const b = shell.kind === 'ok' ? shell.branding : null;
  const css = brandCss(b?.brand);
  const mark = brandingForMark(env.publicApiUrl, b);
  const name = (mark?.displayName || (shell.kind === 'ok' ? shell.tenant.displayName : '') || params.tenantSlug).trim();
  const powered = poweredByVisible('storefront', b?.brand);
  return (
    <>
      {css && <style data-kv-tenant-brand={String(b!.brand!.version)} dangerouslySetInnerHTML={{ __html: css }} />}
      <TenantHeader slug={params.tenantSlug} name={name} logoSrc={mark?.logoUrl ?? null} showPoweredBy={powered} />
      <main className="kv-container" id="main">
        {shell.kind === 'unavailable' && <p className="kv-state kv-state--error" role="status" data-kv-state="degraded">{t.t('tenant.degraded')}</p>}
        {b?.brand && <BrandChangeNote tenantSlug={params.tenantSlug} version={b.brand.version}
          title={t.t('brand.note.title')} body={t.t('brand.note.body', { name })} dismiss={t.t('brand.note.dismiss')} />}
        {children}
      </main>
      <TenantFooter name={name} showPoweredBy={powered} />
    </>
  );
}
