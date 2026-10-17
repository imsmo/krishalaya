// apps/web-storefront/src/features/branding/brand-theme.ts · PURE helpers (no React / IO) — PC-56 TENANT-13d · A5 "make the brand REAL".
//
// What a tenant's storefront renders from its PUBLISHED brand (`GET /v1/storefront/branding` → `brand`, never a draft):
//   • the four colours as CSS custom properties on :root for the tenant's routes — each re-validated `#rrggbb` here (a value that is not a
//     colour never reaches a stylesheet: the CSS-injection vector F-13 named is closed at the consumer too). The colours are certified by
//     the contrast law for the LIGHT surface; in the dark theme the platform's dark neutrals stay (named, not faked);
//   • the PWA manifest and metadata: name = display name, short_name = app short name, theme_color = primary, icon = the published logo;
//     the platform's own name (`PLATFORM_BRAND`, packages/tokens — the one brand-mark list) only where no tenant is resolved;
//   • "Powered by Krishalaya": on every member-facing surface unless the tenant chose to hide it AND its plan allows it right now; on trust
//     surfaces (escrow, KYC, disputes, ledger receipts, documents) always — `showsPoweredBy` from packages/tokens, one constant list;
//   • the one-time "same organisation, new look" note: shown once when a member who had seen an EARLIER version comes back.
import { PLATFORM_BRAND, PLATFORM_BRAND_COLOURS, normaliseHex, showsPoweredBy, type BrandSurface } from '@krishalaya/tokens';
import type { PublishedBrand, TenantBranding } from '@krishalaya/sdk-js';
import { manifestIdentity, tenantIcons } from '../store6/manifest';

export { PLATFORM_BRAND };

/** The published brand's colours, each re-validated; null when there is no brand (the platform stylesheet stands). */
export function brandColours(brand: PublishedBrand | null | undefined): { primary: string; accent: string; ink: string; surface: string } | null {
  if (!brand) return null;
  const c = { primary: normaliseHex(brand.colours?.primary ?? ''), accent: normaliseHex(brand.colours?.accent ?? ''), ink: normaliseHex(brand.colours?.ink ?? ''), surface: normaliseHex(brand.colours?.surface ?? '') };
  if (!c.primary || !c.accent || !c.ink || !c.surface) return null;   // a brand that is not four colours is not applied at all
  return c as { primary: string; accent: string; ink: string; surface: string };
}

/**
 * The :root token block for a tenant route. The storefront's own variables (--kv-brand-500/700 for headings, links and buttons,
 * --kv-neutral-0/900 for the surface and body text) are pointed at the tenant's certified pairs in the light theme; four --kv-tenant-*
 * tokens carry the raw colours (the accent is only ever drawn on ink — the pair the law certified).
 */
export function brandCss(brand: PublishedBrand | null | undefined): string | null {
  const c = brandColours(brand);
  if (!c) return null;
  return [
    `:root{--kv-tenant-primary:${c.primary};--kv-tenant-accent:${c.accent};--kv-tenant-ink:${c.ink};--kv-tenant-surface:${c.surface}}`,
    `:root:not([data-theme="dark"]){--kv-brand-500:${c.primary};--kv-brand-700:${c.primary};--kv-neutral-0:${c.surface};--kv-neutral-900:${c.ink}}`,
  ].join('\n');
}

/** The published logo's absolute URL (the API serves it version-pinned, content-type locked). */
export function logoSrc(apiOrigin: string, brand: PublishedBrand | null | undefined): string | null {
  if (!brand?.logoPath || !/^\/v1\/storefront\/branding\/logo\/[0-9a-f-]{36}\/\d+$/.test(brand.logoPath)) return null;
  return `${apiOrigin.replace(/\/+$/, '')}${brand.logoPath}`;
}

/** What the brand mark should render: the published name and logo when there is a brand; the pre-13d fields otherwise. */
export function brandingForMark(apiOrigin: string, b: TenantBranding | null): { displayName: string; logoUrl: string | null } | null {
  if (!b) return null;
  if (b.brand) return { displayName: b.brand.displayName, logoUrl: logoSrc(apiOrigin, b.brand) };
  return { displayName: b.displayName, logoUrl: b.logoUrl };
}

// PC-56 STORE-6a · D6 (survey F-5): + `id`, `lang`, `dir` on both manifests (features/store6/manifest.ts `manifestIdentity`).
export interface ManifestShape {
  id: string; lang: string; dir: 'ltr' | 'rtl';
  name: string; short_name: string; description: string; start_url: string; scope?: string; display: 'standalone';
  background_color: string; theme_color: string; icons: Array<{ src: string; sizes: string; type: string; purpose?: 'any' | 'maskable' }>;
}
/** The platform's OWN icons (public/) — the platform manifest's only. Exported so the white-label specs can prove a tenant manifest never
 *  carries one (PC-56 STORE-6a · D6). */
export const PLATFORM_ICONS: ManifestShape['icons'] = [
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];
/** The language a manifest is written in (the person's language at install — a later switch applies at the next open). */
export interface ManifestLocale { lang: string; dir: 'ltr' | 'rtl' }
const DEFAULT_LOCALE: ManifestLocale = { lang: 'en', dir: 'ltr' };

/** The platform's own manifest — only where no tenant is resolved. */
export function platformManifest(description: string, locale: ManifestLocale = DEFAULT_LOCALE): ManifestShape {
  return {
    ...manifestIdentity('/', locale.lang, locale.dir),
    name: PLATFORM_BRAND.platformStoreName, short_name: PLATFORM_BRAND.name, description, start_url: '/', scope: '/', display: 'standalone',
    background_color: '#f6faf6', theme_color: PLATFORM_BRAND_COLOURS.primary, icons: PLATFORM_ICONS,
  };
}

/**
 * A tenant's manifest: its published name / short name / primary / logo; before it publishes, its OWN name on the platform colours
 * (never the platform's own store name for a tenant's storefront — canon: "Members currently see the platform brand with your name").
 * PC-56 STORE-6a · D6 (founder Q6): the icons are the ORGANISATION's only — its logo, or its generated monogram (`/<slug>/app-icon.svg`); the
 * platform's icons are never appended (they were the install fallback, the platform's maskable 512 included). `startUrl` is `/<slug>` on a
 * path store and `/` on a store's own host (one manifest per store — the caller decides from the host routing).
 */
export function tenantManifest(b: TenantBranding | null, slug: string, startUrl: string, apiOrigin: string, description: string, locale: ManifestLocale = DEFAULT_LOCALE): ManifestShape {
  const brand = b?.brand ?? null;
  const c = brandColours(brand);
  const name = (brand?.displayName || b?.displayName || slug).trim();
  const short = (brand?.appShortName || name).slice(0, 12).trim();
  const logo = logoSrc(apiOrigin, brand);
  return {
    ...manifestIdentity(startUrl, locale.lang, locale.dir),
    name, short_name: short, description, start_url: startUrl, scope: startUrl, display: 'standalone',
    background_color: c?.surface ?? '#ffffff', theme_color: c?.primary ?? PLATFORM_BRAND_COLOURS.primary,
    icons: tenantIcons(logo, brand?.logoMime ?? null, slug),
  };
}

/** Does this surface show "Powered by Krishalaya"? (the tokens rule; the brand's flag already includes the plan read for real) */
export function poweredByVisible(surface: BrandSurface, brand: PublishedBrand | null | undefined): boolean {
  return showsPoweredBy(surface, brand?.poweredByHidden === true, brand?.poweredByHidden === true);
}

/**
 * The one-time "same organisation, new look" note. `seen` is the last brand version this browser saw for the tenant (a cookie), or
 * undefined for a first visit. Shown ONLY to someone who saw an earlier version; a first visit just records the current one.
 */
export function brandNoteDecision(seen: string | undefined, version: number | null | undefined): { show: boolean; remember: number | null } {
  const v = typeof version === 'number' && version > 0 ? version : 0;
  const s = seen !== undefined && /^\d{1,9}$/.test(seen) ? Number(seen) : null;
  if (s === null) return { show: false, remember: v };
  return { show: v > s, remember: v > s ? v : null };
}
export function brandSeenCookie(tenantSlug: string): string { return `kv_brand_seen_${tenantSlug.replace(/[^a-z0-9-]/gi, '').slice(0, 50)}`; }

/** Host routing (storefront middleware): which path a request on a tenant host is served from. Pure, so the rule is tested. */
export function hostRewritePath(slug: string, pathname: string): string | null {
  if (pathname === '/' || pathname === '') return `/${slug}`;
  if (pathname.startsWith('/listings/')) return `/${slug}${pathname}`;
  // PC-56 STORE-5b (founder D7 / Q15): the QR on a pack names the HOST's own /trace/<token> — on a store host it is served under the store's
  // chrome (another organisation's lot is sent on to the platform's page by the screen); the certificate page likewise
  if (pathname.startsWith('/trace/') || pathname === '/certificates' || pathname.startsWith('/certificates/')) return `/${slug}${pathname}`;
  if (pathname === '/manifest.webmanifest') return `/${slug}/manifest.webmanifest`;
  // PC-56 STORE-6a · D6 / C3: the offline page (W313 — the worker's fallback on a store host), the queued-actions list (W314) and the install
  // page (W319) are the ORGANISATION's on its own host — and the offline page's form states (`/offline?form=…`, the query is kept by the rewrite)
  if (pathname === '/offline' || pathname === '/queued' || pathname === '/app') return `/${slug}${pathname}`;
  return null;
}
