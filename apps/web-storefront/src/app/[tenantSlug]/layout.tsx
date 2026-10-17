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
//
// PC-56 STORE-6a:
//   • D1 — the ported `OnlineGuard` mounted ONCE here (as in the platform chrome): "— needs signal" on every POST button, "Why?" → THIS store's
//     `/<slug>/offline`; `SignalReasons` prints why beside each money / countdown act; D4 — `UpdateNotice` (never over a form with content);
//   • D2 — a page the middleware marked cacheable (`x-kv-cacheable`: a public page, no session cookie, this organisation's
//     `storefront_offline_reads` ON) is stamped: `<meta name="kv-cacheable">`, `data-kv-rendered-at` on <main>, the hidden `CachedBand`;
//   • D6 — THE ORGANISATION ONLY: the manifest is ONE link — on a store's own host the host-root `/manifest.webmanifest` (start_url `/`), on a
//     path store `/<slug>/manifest.webmanifest`; the icon is the published logo or the generated monogram (`/<slug>/app-icon.svg`), never the
//     platform's; the apple-touch icon only for a PNG logo (none otherwise — never the platform's PNG); the theme colour from the brand's
//     token (the platform token's green only as the colour of an organisation that has published none);
//   • the offline page (`x-kv-shell: offline`, set by the middleware for `/<slug>/offline`) renders the SESSION-FREE chrome
//     (components/offline/TenantShellHeader.tsx): no session read, no cart, no flags, no forms — HOTFIX-8's law on the store's own fallback.
// PC-56 STORE-SWEEP-a · D3 / D4: the footer carries this store's Help / Quality promise / Contact, the PLATFORM's Grievances link and "Powered by" as a
// link to the platform's About — on a host-routed request those two point at the platform's origin (`env.siteUrl`, NEXT_PUBLIC_SITE_URL), on a path
// store at the same origin.
// PC-56 STORE-6b · D3: the install invitation (components/install/InstallInvite.tsx) mounted ONCE here with the organisation's name and icon EXACTLY
// as its manifest has them (brand-theme.ts `tenantManifest`: the published display name, else the tenant's, else the slug; the logo, else the
// monogram) and THIS organisation's `storefront_install_prompt` (the public flags read — fail closed: unreadable → OFF). Not in the offline
// shell (no flags are read there).
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { PLATFORM_BRAND_COLOURS } from '@krishalaya/tokens';
import { env } from '../../lib/env';
import { getTranslator } from '../../lib/i18n';
import { loadTenantShell } from '../../lib/storefront-data';
import { TENANT_SLUG_HEADER } from '../../lib/host-routing';
import { brandCss, brandColours, logoSrc, brandingForMark, poweredByVisible } from '../../features/branding/brand-theme';
import { publicClient } from '../../lib/api-client';
import { InstallInvite } from '../../components/install/InstallInvite';
import { inviteLabels } from '../../lib/drafts-labels';
import { tenantChrome } from '../../features/store4a/account';
import { appHref } from '../../features/store6b/paths';
import { monogramHref, tenantAppleIcon } from '../../features/store6/manifest';
import { CACHEABLE_HEADER, SHELL_HEADER } from '../../features/store6/sw-rules';
import { BrandChangeNote } from '../../components/BrandChangeNote';
import { TenantHeader } from '../../components/TenantHeader';
import { TenantFooter } from '../../components/TenantFooter';
import { OnlineGuard } from '../../components/OnlineGuard';
import { SignalReasons } from '../../components/offline/SignalReasons';
import { UpdateNotice } from '../../components/offline/UpdateNotice';
import { CachedBand } from '../../components/offline/CachedBand';
import { TenantShellHeader } from '../../components/offline/TenantShellHeader';
import { bandLabels, reasonWords, signalLabels, updateLabels } from '../../lib/offline-labels';

/** Is this request host-routed to THIS organisation (its own domain — the middleware named it)? */
const hostRouted = (slug: string) => headers().get(TENANT_SLUG_HEADER) === slug;
const cacheable = () => headers().get(CACHEABLE_HEADER) === 'public';
const shellMode = () => headers().get(SHELL_HEADER) === 'offline';

export async function generateMetadata({ params }: { params: { tenantSlug: string } }): Promise<Metadata> {
  const shell = await loadTenantShell(params.tenantSlug);
  const b = shell.kind === 'ok' ? shell.branding : null;
  const name = (b?.brand?.displayName || b?.displayName || (shell.kind === 'ok' ? shell.tenant.displayName : '') || params.tenantSlug).trim();
  const logo = logoSrc(env.publicApiUrl, b?.brand);
  const apple = tenantAppleIcon(logo, b?.brand?.logoMime);
  return {
    title: { default: name, template: `%s · ${name}` },
    applicationName: name,
    // STORE-6a · D6: ONE manifest — the host-root one on the store's own host (it answers this store's manifest with start_url `/`)
    manifest: hostRouted(params.tenantSlug) ? '/manifest.webmanifest' : `/${params.tenantSlug}/manifest.webmanifest`,
    appleWebApp: { capable: true, statusBarStyle: 'default', title: (b?.brand?.appShortName || name).slice(0, 12) },
    // STORE-6a · D6: the organisation's icon only (its logo, else its monogram); the apple-touch icon only for a PNG logo — never the platform's
    icons: { icon: [logo ? { url: logo, type: b!.brand!.logoMime } : { url: monogramHref(params.tenantSlug), type: 'image/svg+xml' }], ...(apple ? { apple } : {}) },
    ...(cacheable() ? { other: { 'kv-cacheable': 'public' } } : {}),
  };
}

export async function generateViewport({ params }: { params: { tenantSlug: string } }): Promise<Viewport> {
  const shell = await loadTenantShell(params.tenantSlug);
  const b = shell.kind === 'ok' ? shell.branding : null;
  return { themeColor: brandColours(b?.brand)?.primary ?? PLATFORM_BRAND_COLOURS.primary };   // STORE-6a (survey F-16): the token, not a literal
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
  const platformOrigin = hostRouted(params.tenantSlug) ? env.siteUrl : '';   // STORE-SWEEP-a: the platform's pages from a store's own host
  const degraded = shell.kind === 'unavailable' && <p className="kv-state kv-state--error" role="status" data-kv-state="degraded">{t.t('tenant.degraded')}</p>;
  if (shellMode()) {
    // the offline page: the organisation's name and mark only — the same HTML for every person on the phone
    return (
      <>
        {css && <style data-kv-tenant-brand={String(b!.brand!.version)} dangerouslySetInnerHTML={{ __html: css }} />}
        <TenantShellHeader slug={params.tenantSlug} name={name} logoSrc={mark?.logoUrl ?? null} showPoweredBy={powered} />
        <main className="kv-container" id="main">{degraded}{children}</main>
        <TenantFooter name={name} slug={params.tenantSlug} showPoweredBy={powered} platformOrigin={platformOrigin} />
      </>
    );
  }
  const signal = signalLabels(`/${params.tenantSlug}/offline`);
  const renderedAt = cacheable() ? new Date().toISOString() : null;
  // STORE-6b · D3: the invitation names the organisation and its icon as its manifest does; this organisation's switch (fail closed)
  let installOn = false;
  try { installOn = (await publicClient(params.tenantSlug).storefront.flags()).storefront_install_prompt === true; } catch { installOn = false; }
  const manifestName = (b?.brand?.displayName || b?.displayName || params.tenantSlug).trim();
  const manifestIcon = logoSrc(env.publicApiUrl, b?.brand) ?? monogramHref(params.tenantSlug);
  return (
    <>
      {css && <style data-kv-tenant-brand={String(b!.brand!.version)} dangerouslySetInnerHTML={{ __html: css }} />}
      <TenantHeader slug={params.tenantSlug} name={name} logoSrc={mark?.logoUrl ?? null} showPoweredBy={powered} />
      <main className="kv-container" id="main" {...(renderedAt ? { 'data-kv-rendered-at': renderedAt } : {})}>
        <OnlineGuard labels={signal} />
        <SignalReasons words={reasonWords()} needsSignal={signal.needsSignal} />
        <UpdateNotice labels={updateLabels()} />
        {renderedAt && <CachedBand at={renderedAt} labels={bandLabels()} />}
        {degraded}
        {b?.brand && <BrandChangeNote tenantSlug={params.tenantSlug} version={b.brand.version}
          title={t.t('brand.note.title')} body={t.t('brand.note.body', { name })} dismiss={t.t('brand.note.dismiss')} />}
        {children}
        <InstallInvite name={manifestName} iconHref={manifestIcon} flagOn={installOn} appHref={appHref(tenantChrome(params.tenantSlug))} labels={inviteLabels()} />
      </main>
      <TenantFooter name={name} slug={params.tenantSlug} showPoweredBy={powered} platformOrigin={platformOrigin} />
    </>
  );
}
