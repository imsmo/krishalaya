// apps/web-storefront/src/features/store6/manifest.ts · PC-56 STORE-6a · D6 (founder Q6, survey F-5 / F-16 / B4) — THE INSTALLED APP IS THE
// ORGANISATION'S. PURE.
//   • A tenant's manifest NEVER carries the platform's icons (it appended `PLATFORM_ICONS` — the platform's MASKABLE 512 included — behind any
//     logo, and offered ONLY them before a logo was published; on Android the launcher picks a maskable icon when offered): a published logo →
//     that logo (a PNG as `any` AND `maskable`; an SVG scales, `any`); no logo → a GENERATED MONOGRAM, `/<slug>/app-icon.svg`: the
//     organisation's initial(s) on its own primary colour (the platform token's green only as the colour when it has published none — a colour,
//     never a mark), `any` + `maskable`, 512.
//   • `id`, `lang`, `dir` on both manifests (the language the person installs in; a later language switch applies at the next open).
//   • The apple-touch-icon: iOS does not take an SVG there, and no raster library ships here — so a tenant WITHOUT a PNG logo has NO apple link
//     at all (never the platform's PNG: the store host answers `/apple-touch-icon.png` 404, see middleware.ts; on a PATH store iOS may still
//     fall back to the origin's own file — the honest limit, named in the report).
// The route is `app-icon.svg`, not the brief's `icon.svg`: Next 14 treats any path segment named `icon.<ext>` as its metadata-image convention
// (next/dist/lib/metadata/is-metadata-route.js) and would rewrite the route — named as a deviation.
import { PLATFORM_BRAND_COLOURS, normaliseHex } from '@krishalaya/tokens';

export type ManifestIcon = { src: string; sizes: string; type: string; purpose?: 'any' | 'maskable' };

/** The tenant's monogram route (a path every host answers: the path form `/<slug>/…` passes the host middleware untouched). */
export function monogramHref(slug: string): string { return `/${slug}/app-icon.svg`; }

/** The icons of a tenant's manifest — the organisation's only. */
export function tenantIcons(logo: string | null, logoMime: string | null | undefined, slug: string): ManifestIcon[] {
  if (logo && logoMime === 'image/svg+xml') return [{ src: logo, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }];
  if (logo && logoMime) return [{ src: logo, sizes: '512x512', type: logoMime, purpose: 'any' }, { src: logo, sizes: '512x512', type: logoMime, purpose: 'maskable' }];
  const m = monogramHref(slug);
  return [{ src: m, sizes: '512x512', type: 'image/svg+xml', purpose: 'any' }, { src: m, sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' }];
}

/** The apple-touch-icon a tenant may link: its PNG logo only (iOS takes no SVG there); otherwise none. */
export function tenantAppleIcon(logo: string | null, logoMime: string | null | undefined): string | null {
  return logo && logoMime === 'image/png' ? logo : null;
}

/** Up to two initials from the organisation's name — the first letter of its first two words (any script), Latin upper-cased. */
export function monogramInitials(name: string): string {
  const words = String(name ?? '').trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const first = (w: string) => { const c = Array.from(w).find((ch) => /[\p{L}\p{N}]/u.test(ch)) ?? ''; return c.toLocaleUpperCase('en'); };
  const out = words.slice(0, 2).map(first).join('');
  return out || '·';
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
/** Black or white ink, whichever reads on the background (the WCAG luminance split). */
function inkOn(bg: string): string {
  const h = bg.slice(1);
  const ch = [0, 2, 4].map((i) => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  const l = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return l > 0.179 ? '#111111' : '#ffffff';
}

/** The monogram: the initial(s) centred on the organisation's colour, a full-bleed square (maskable: the letters sit well inside the safe zone). */
export function monogramSvg(name: string, colour: string | null | undefined): string {
  const bg = normaliseHex(colour ?? '') ?? PLATFORM_BRAND_COLOURS.primary;
  const ink = inkOn(bg);
  const initials = escapeXml(monogramInitials(name));
  const size = Array.from(monogramInitials(name)).length > 1 ? 184 : 232;
  const label = escapeXml(String(name ?? '').trim().slice(0, 80));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="${label}">`
    + `<rect width="512" height="512" fill="${bg}"/>`
    + `<text x="256" y="256" dy="0.35em" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', 'Noto Sans', sans-serif" font-size="${size}" font-weight="700" fill="${ink}">${initials}</text>`
    + `</svg>`;
}

/** The manifest's identity fields: the app id is its start URL (stable per store); the language and direction the person installs in. */
export function manifestIdentity(startUrl: string, lang: string, dir: 'ltr' | 'rtl'): { id: string; lang: string; dir: 'ltr' | 'rtl' } {
  return { id: startUrl, lang: /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(lang) ? lang : 'en', dir: dir === 'rtl' ? 'rtl' : 'ltr' };
}
