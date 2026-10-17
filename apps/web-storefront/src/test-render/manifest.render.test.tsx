// apps/web-storefront/src/test-render/manifest.render.test.tsx · PC-56 STORE-6a · D6 (founder Q6, survey F-5 / F-16 / B4) — THE INSTALLED APP IS THE
// ORGANISATION'S. Called as Next calls them (the routes' GET, the root manifest, the tenant layout's metadata):
//   • a tenant manifest carries NO platform icon (none of PLATFORM_ICONS, no `/icon-*`), never the platform's name, a description with the
//     organisation alone; no logo → the generated monogram (`/<slug>/app-icon.svg`, any + maskable); a PNG logo → any + maskable; an SVG → any;
//   • ONE manifest per store: on its own host (`x-kv-tenant-slug` = it) start_url / scope / id `/`, the layout links `/manifest.webmanifest`;
//     on a path store `/<slug>` and `/<slug>/manifest.webmanifest`;
//   • `id`, `lang`, `dir` on both manifests (the person's language at install); the platform's manifest keeps the platform's own icons;
//   • the monogram route: the organisation's initials on its own colour, 512, SVG; an unknown organisation → 404;
//   • the apple-touch icon: the PNG logo only — never the platform's `/apple-touch-icon.png`.
// Mutant M4 (`tenantManifest` appending PLATFORM_ICONS again) turns this red.
jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./store6a-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./store6a-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient }; });
jest.mock('../lib/storefront-data', () => { const f = jest.requireActual('./store6a-fixtures'); return { loadTenantShell: f.loadTenantShell }; });

import { PLATFORM_BRAND } from '@krishalaya/tokens';
import { GET as tenantManifestRoute } from '../app/[tenantSlug]/manifest.webmanifest/route';
import { GET as monogramRoute } from '../app/[tenantSlug]/app-icon.svg/route';
import { GET as rootManifestRoute } from '../app/(platform)/manifest.webmanifest/route';
import { generateMetadata as tenantMeta } from '../app/[tenantSlug]/layout';
import { PLATFORM_ICONS } from '../features/branding/brand-theme';
import { monogramInitials, monogramSvg } from '../features/store6/manifest';
import { C, ORG, SLUG, T, brandWith, reset, withCookies } from './store6a-fixtures';

beforeEach(() => reset());
const PNG = { logoPath: `/v1/storefront/branding/logo/${T}/3`, logoMime: 'image/png' };
const SVG = { logoPath: `/v1/storefront/branding/logo/${T}/3`, logoMime: 'image/svg+xml' };
const LOGO = `https://api.test/v1/storefront/branding/logo/${T}/3`;
const manifestOf = async (hostRouted: boolean) => {
  const req = new Request(`https://store.test/${SLUG}/manifest.webmanifest`, { headers: hostRouted ? { 'x-kv-tenant-slug': SLUG } : {} });
  const r = await tenantManifestRoute(req, { params: { tenantSlug: SLUG } });
  return { r, m: JSON.parse(await r.text()) };
};
const PLATFORM_SRCS = PLATFORM_ICONS.map((i) => i.src);
const noPlatform = (m: { icons: Array<{ src: string }>; name: string; short_name: string; description: string }) => {
  for (const i of m.icons) { expect(PLATFORM_SRCS).not.toContain(i.src); expect(i.src).not.toMatch(/^\/icon-|apple-touch-icon/); }
  for (const v of [m.name, m.short_name, m.description]) { expect(v).not.toContain(PLATFORM_BRAND.name); expect(v).not.toContain(PLATFORM_BRAND.platformStoreName); }
};

describe('STORE-6a · D6 · a tenant manifest is the organisation\'s only', () => {
  it('no logo → its generated monogram (any + maskable, 512); never a platform icon or name; the description names the organisation alone', async () => {
    C.branding = brandWith({ logoPath: null, logoMime: null });
    const { r, m } = await manifestOf(false);
    expect(r.headers.get('content-type')).toBe('application/manifest+json; charset=utf-8');
    expect(m.icons).toEqual([
      { src: `/${SLUG}/app-icon.svg`, sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
      { src: `/${SLUG}/app-icon.svg`, sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
    ]);
    noPlatform(m);
    expect(m.name).toBe(ORG); expect(m.description).toBe(`Fresh produce and farm inputs from ${ORG}.`);
    expect(m.theme_color).toBe('#7a3e00');
  });
  it('a PNG logo → any AND maskable; an SVG logo → any (it scales); still nothing of the platform', async () => {
    C.branding = brandWith(PNG);
    let { m } = await manifestOf(false);
    expect(m.icons).toEqual([{ src: LOGO, sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: LOGO, sizes: '512x512', type: 'image/png', purpose: 'maskable' }]);
    noPlatform(m);
    C.branding = brandWith(SVG);
    ({ m } = await manifestOf(false));
    expect(m.icons).toEqual([{ src: LOGO, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]);
    noPlatform(m);
  });
  it('ONE manifest per store: a path store → /<slug>; the store\'s own host → `/` (start_url, scope, id); lang and dir from the person\'s language', async () => {
    let { m } = await manifestOf(false);
    expect([m.start_url, m.scope, m.id, m.lang, m.dir]).toEqual([`/${SLUG}`, `/${SLUG}`, `/${SLUG}`, 'en', 'ltr']);
    ({ m } = await manifestOf(true));
    expect([m.start_url, m.scope, m.id]).toEqual(['/', '/', '/']);
    withCookies({ kv_lang: 'gu' });
    ({ m } = await manifestOf(false));
    expect([m.lang, m.dir]).toEqual(['gu', 'ltr']);
    expect(m.description).not.toContain(PLATFORM_BRAND.name);
  });
  it('the root manifest (a ROUTE now — the file convention overrode every layout): the platform\'s own; routed to a store → the store\'s', async () => {
    const root = async (h: Record<string, string> = {}) => JSON.parse(await (await rootManifestRoute(new Request('https://store.test/manifest.webmanifest', { headers: h }))).text());
    const p = await root();
    expect(p).toMatchObject({ name: PLATFORM_BRAND.platformStoreName, id: '/', lang: 'en', dir: 'ltr', start_url: '/' });
    expect(p.icons).toEqual(PLATFORM_ICONS);
    C.branding = brandWith({ logoPath: null, logoMime: null });
    const t = await root({ 'x-kv-tenant-slug': SLUG }) as { icons: Array<{ src: string }>; name: string; short_name: string; description: string; start_url: string };
    expect(t.start_url).toBe('/'); expect(t.name).toBe(ORG); noPlatform(t);
  });
  it('the layout: the host-root manifest on the store\'s own host, its own path otherwise; the monogram icon; the apple icon for a PNG logo only', async () => {
    C.branding = brandWith({ logoPath: null, logoMime: null });
    let md = await tenantMeta({ params: { tenantSlug: SLUG } });
    expect(md.manifest).toBe(`/${SLUG}/manifest.webmanifest`);
    expect(md.icons).toEqual({ icon: [{ url: `/${SLUG}/app-icon.svg`, type: 'image/svg+xml' }] });   // no apple at all — never the platform's PNG
    C.headers = { 'x-kv-tenant-slug': SLUG };
    md = await tenantMeta({ params: { tenantSlug: SLUG } });
    expect(md.manifest).toBe('/manifest.webmanifest');
    C.branding = brandWith(PNG);
    md = await tenantMeta({ params: { tenantSlug: SLUG } });
    expect(md.icons).toEqual({ icon: [{ url: LOGO, type: 'image/png' }], apple: LOGO });
    C.branding = brandWith(SVG);
    md = await tenantMeta({ params: { tenantSlug: SLUG } });
    expect(JSON.stringify(md.icons)).not.toMatch(/apple|\/apple-touch-icon\.png|\/icon-/);
  });
});

describe('STORE-6a · D6 · the generated monogram', () => {
  it('the route: the organisation\'s initials on ITS colour, 512 × 512 SVG; an unknown organisation → 404', async () => {
    const r = await monogramRoute(new Request(`https://store.test/${SLUG}/app-icon.svg`), { params: { tenantSlug: SLUG } });
    expect(r.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    const svg = await r.text();
    expect(svg).toContain('width="512" height="512"'); expect(svg).toContain('fill="#7a3e00"'); expect(svg).toContain('>AF</text>');
    expect(svg).toContain(`aria-label="${ORG}"`);
    C.branding = null;
    expect((await monogramRoute(new Request('https://store.test/x/app-icon.svg'), { params: { tenantSlug: 'x' } })).status).toBe(404);
  });
  it('initials in any script; markup-safe; ink that reads on the colour; the token colour only when the organisation published none', () => {
    expect(monogramInitials('Anand FPO Mandi')).toBe('AF');
    expect(monogramInitials('आनंद किसान संघ')).toBe('आक');
    expect(monogramInitials('  ')).toBe('·');
    expect(monogramSvg('<b>&"x\'', '#ffffff')).toContain('&lt;b&gt;&amp;&quot;x&apos;');
    expect(monogramSvg('Light Org', '#ffffff')).toContain('fill="#111111">LO');
    expect(monogramSvg('Dark Org', '#123456')).toContain('fill="#ffffff">DO');
    expect(monogramSvg('No Colour', 'red;}')).toContain('fill="#1e6f3f"');
  });
});
