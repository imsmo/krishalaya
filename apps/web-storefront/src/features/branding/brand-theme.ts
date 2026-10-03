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

export interface ManifestShape {
  name: string; short_name: string; description: string; start_url: string; scope?: string; display: 'standalone';
  background_color: string; theme_color: string; icons: Array<{ src: string; sizes: string; type: string; purpose?: 'any' | 'maskable' }>;
}
const PLATFORM_ICONS: ManifestShape['icons'] = [
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

/** The platform's own manifest — only where no tenant is resolved. */
export function platformManifest(description: string): ManifestShape {
  return {
    name: PLATFORM_BRAND.platformStoreName, short_name: PLATFORM_BRAND.name, description, start_url: '/', display: 'standalone',
    background_color: '#f6faf6', theme_color: PLATFORM_BRAND_COLOURS.primary, icons: PLATFORM_ICONS,
  };
}

/**
 * A tenant's manifest: its published name / short name / primary / logo; before it publishes, its OWN name on the platform colours
 * (never the platform's own store name for a tenant's storefront — canon: "Members currently see the platform brand with your name").
 */
export function tenantManifest(b: TenantBranding | null, slug: string, startUrl: string, apiOrigin: string, description: string): ManifestShape {
  const brand = b?.brand ?? null;
  const c = brandColours(brand);
  const name = (brand?.displayName || b?.displayName || slug).trim();
  const short = (brand?.appShortName || name).slice(0, 12).trim();
  const logo = logoSrc(apiOrigin, brand);
  return {
    name, short_name: short, description, start_url: startUrl, scope: startUrl, display: 'standalone',
    background_color: c?.surface ?? '#ffffff', theme_color: c?.primary ?? PLATFORM_BRAND_COLOURS.primary,
    // an SVG logo scales to any size; a PNG is offered at its published bytes — the platform icons stay as the install fallback
    icons: logo ? [{ src: logo, sizes: brand!.logoMime === 'image/svg+xml' ? 'any' : '512x512', type: brand!.logoMime, purpose: 'any' }, ...PLATFORM_ICONS] : PLATFORM_ICONS,
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
  if (pathname === '/manifest.webmanifest') return `/${slug}/manifest.webmanifest`;
  return null;
}
