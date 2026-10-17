// apps/web-storefront/src/test/tenant13d-white-label.spec.ts · PC-56 TENANT-13d · A5 / B3 — the storefront wears the tenant's PUBLISHED
// brand: manifest and metadata are tenant-aware, the colours reach :root only as #rrggbb, "Powered by Krishalaya" follows the one rule
// (never hidden on a trust surface), the one-time note shows once, Host routing rewrites only what it should — and the hard-coded
// "Krishalaya Store" literal is gone from the storefront (the platform name lives in packages/tokens' brand-mark list).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { PublishedBrand, TenantBranding } from '@krishalaya/sdk-js';
import {
  brandCss, brandNoteDecision, brandSeenCookie, brandingForMark, hostRewritePath, logoSrc, platformManifest, poweredByVisible, tenantManifest, PLATFORM_BRAND, PLATFORM_ICONS,
} from '../features/branding/brand-theme';
import { isOwnHost } from '../lib/host-routing';

const SRC = join(__dirname, '..');
function walk(dir: string): string[] { return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; }); }
const T = '01a10000-0000-7000-8000-00000000000a';
const brand = (o: Partial<PublishedBrand> = {}): PublishedBrand => ({
  version: 3, displayName: 'Anand FPO Mandi', appShortName: 'Anand Mandi', logoPath: `/v1/storefront/branding/logo/${T}/3`, logoMime: 'image/svg+xml',
  colours: { primary: '#1e6f3f', accent: '#f39c12', ink: '#232a33', surface: '#ffffff' }, poweredByHidden: false, publishedAt: '2026-10-03T10:00:00.000Z', ...o,
});
const branding = (b: PublishedBrand | null): TenantBranding => ({ displayName: 'Anand FPO', logoUrl: null, brand: b });

describe('PC-56 TENANT-13d · manifest and metadata are tenant-aware', () => {
  it('a published brand: name, short name, theme colour and logo icon are the tenant\'s', () => {
    const m = tenantManifest(branding(brand()), 'anand-fpo', '/anand-fpo', 'https://api.example', 'desc');
    expect(m).toMatchObject({ name: 'Anand FPO Mandi', short_name: 'Anand Mandi', theme_color: '#1e6f3f', background_color: '#ffffff', start_url: '/anand-fpo', scope: '/anand-fpo' });
    expect(m.icons[0]).toEqual({ src: `https://api.example/v1/storefront/branding/logo/${T}/3`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' });
  });
  it('before a tenant publishes: ITS name on the platform colours — never the platform\'s store name', () => {
    const m = tenantManifest(branding(null), 'anand-fpo', '/anand-fpo', 'https://api.example', 'desc');
    expect(m.name).toBe('Anand FPO'); expect(m.name).not.toBe(PLATFORM_BRAND.platformStoreName); expect(m.theme_color).toBe('#1e6f3f');
  });
  // PC-56 STORE-6a · D6 (founder Q6): a tenant manifest NEVER carries a platform icon — with a logo (SVG or PNG) or without (the monogram)
  it('STORE-6a: no platform icon in a tenant manifest — logo, PNG logo, or the monogram before a logo is published; id / lang / dir', () => {
    const srcs = PLATFORM_ICONS.map((i) => i.src);
    for (const b of [branding(brand()), branding(brand({ logoMime: 'image/png' })), branding(null), branding(brand({ logoPath: null, logoMime: null } as never))]) {
      const m = tenantManifest(b, 'anand-fpo', '/anand-fpo', 'https://api.example', 'desc', { lang: 'hi', dir: 'ltr' });
      for (const i of m.icons) expect(srcs).not.toContain(i.src);
      expect(m.icons.length).toBeGreaterThan(0);
      expect([m.id, m.lang, m.dir]).toEqual(['/anand-fpo', 'hi', 'ltr']);
    }
    expect(tenantManifest(branding(null), 'anand-fpo', '/anand-fpo', 'https://api.example', 'desc').icons[0].src).toBe('/anand-fpo/app-icon.svg');
    expect(platformManifest('d').icons).toEqual(PLATFORM_ICONS);
  });
  it('only the platform\'s own pages get the platform manifest (from the one brand-mark list)', () => {
    expect(platformManifest('d')).toMatchObject({ name: PLATFORM_BRAND.platformStoreName, short_name: PLATFORM_BRAND.name });
  });
  it('the [tenantSlug] layout sets title, manifest and theme colour from the brand; the root manifest reads the Host-routed tenant', () => {
    const layout = readFileSync(join(SRC, 'app', '[tenantSlug]', 'layout.tsx'), 'utf8');
    // PC-56 STORE-6a · D6: ONE manifest per store — the host-root one on the store's own host, its own path on a path store
    expect(layout).toMatch(/manifest: hostRouted\(params\.tenantSlug\) \? '\/manifest\.webmanifest' : `\/\$\{params\.tenantSlug\}\/manifest\.webmanifest`/);
    expect(layout).toMatch(/title: \{ default: name/); expect(layout).toMatch(/themeColor: brandColours\(b\?\.brand\)\?\.primary/);
    // PC-56 STORE-6a · D6: the host-root manifest is a ROUTE (it was the `app/manifest.ts` file convention, which overrode every layout's link)
    expect(readFileSync(join(SRC, 'app', '(platform)', 'manifest.webmanifest', 'route.ts'), 'utf8')).toMatch(/TENANT_SLUG_HEADER/);
    expect(readFileSync(join(SRC, 'app', 'layout.tsx'), 'utf8')).toMatch(/manifest: '\/manifest\.webmanifest'/);
  });
  // PC-56 STORE-1b · founder decision D2 (2026-10-13): the platform store is "Krishalaya Bazaar" (it was "Krishalaya Store"). Neither the old
  // nor the new name is a literal in any storefront source — both come from packages/tokens' one brand-mark list.
  it('no storefront source hard-codes the platform store name (old "Krishalaya Store" or D2\'s "Krishalaya Bazaar") — it comes from tokens', () => {
    const offenders = walk(SRC).filter((f) => /\.(ts|tsx|js)$/.test(f) && !f.includes(`${join('src', 'test')}`))
      .filter((f) => { const x = readFileSync(f, 'utf8'); return x.includes('Krishalaya Store') || x.includes('Krishalaya Bazaar'); });
    expect(offenders).toEqual([]);
    expect(PLATFORM_BRAND.platformStoreName).toBe('Krishalaya Bazaar');   // founder D2; kept in the brand-mark list
  });
});

describe('PC-56 TENANT-13d · colours, logo, mark, note', () => {
  it(':root gets the four tokens; the dark theme keeps its neutrals; anything that is not #rrggbb is never emitted', () => {
    const css = brandCss(brand())!;
    expect(css).toContain('--kv-tenant-primary:#1e6f3f'); expect(css).toContain(':root:not([data-theme="dark"]){--kv-brand-500:#1e6f3f');
    expect(brandCss(brand({ colours: { primary: 'red;}body{display:none', accent: '#f39c12', ink: '#232a33', surface: '#ffffff' } }))).toBeNull();
    expect(brandCss(null)).toBeNull();
  });
  it('the logo is the version-pinned API path only; the brand mark uses the published name and logo', () => {
    expect(logoSrc('https://api.example/', brand())).toBe(`https://api.example/v1/storefront/branding/logo/${T}/3`);
    expect(logoSrc('https://api.example', brand({ logoPath: 'https://evil.example/x.svg' }))).toBeNull();
    expect(brandingForMark('https://api.example', branding(brand()))).toEqual({ displayName: 'Anand FPO Mandi', logoUrl: `https://api.example/v1/storefront/branding/logo/${T}/3` });
    expect(brandingForMark('https://api.example', branding(null))).toEqual({ displayName: 'Anand FPO', logoUrl: null });
  });
  it('"Powered by Krishalaya": shown unless hidden (with the plan, folded into the brand by the API); NEVER hidden on a trust surface', () => {
    expect(poweredByVisible('storefront', brand())).toBe(true);
    expect(poweredByVisible('storefront', brand({ poweredByHidden: true }))).toBe(false);
    expect(poweredByVisible('escrow', brand({ poweredByHidden: true }))).toBe(true);
    expect(poweredByVisible('kyc', brand({ poweredByHidden: true }))).toBe(true);
    expect(poweredByVisible('storefront', null)).toBe(true);
    // PC-56 STORE-2c · C1: the pay page moved under the organisation (`[tenantSlug]/checkout/pay`) — the platform route is a door; the trust mark
    // stays on the page that takes the money
    // PC-56 STORE-3a · C2 (founder D3): the order page moved under the organisation too (`[tenantSlug]/orders/[id]`) — the mark moved with it
    for (const page of [['app', '[tenantSlug]', 'checkout', 'pay', 'page.tsx'], ['app', '[tenantSlug]', 'orders', '[id]', 'page.tsx']]) expect(readFileSync(join(SRC, ...page), 'utf8')).toMatch(/poweredByVisible\('escrow'/);
  });
  it('the one-time note: never on a first visit; once for someone who saw an earlier version; never twice', () => {
    expect(brandNoteDecision(undefined, 3)).toEqual({ show: false, remember: 3 });
    expect(brandNoteDecision('2', 3)).toEqual({ show: true, remember: 3 });
    expect(brandNoteDecision('3', 3)).toEqual({ show: false, remember: null });
    expect(brandNoteDecision('junk', 3)).toEqual({ show: false, remember: 3 });
    expect(brandSeenCookie('anand-fpo')).toBe('kv_brand_seen_anand-fpo');
  });
});

describe('PC-56 TENANT-13d · Host routing (storefront)', () => {
  it('rewrites only the tenant\'s pages; everything else is untouched', () => {
    expect(hostRewritePath('anand', '/')).toBe('/anand');
    expect(hostRewritePath('anand', '/listings/x')).toBe('/anand/listings/x');
    expect(hostRewritePath('anand', '/manifest.webmanifest')).toBe('/anand/manifest.webmanifest');
    expect(hostRewritePath('anand', '/cart')).toBeNull();
    // PC-56 STORE-5b (founder D7): the trace and certificate pages are served under the store's chrome on its host
    expect(hostRewritePath('anand', '/trace/KVTR9J4K2M')).toBe('/anand/trace/KVTR9J4K2M');
    expect(hostRewritePath('anand', '/trace/KVTR9J4K2M/verify')).toBe('/anand/trace/KVTR9J4K2M/verify');
    expect(hostRewritePath('anand', '/certificates')).toBe('/anand/certificates');
    expect(hostRewritePath('anand', '/trace')).toBe('/anand/trace');   // PC-56 STORE-SWEEP-b · D5: the code-entry page is the store's own now (was null — the platform's)
    // PC-56 STORE-6a · C3: the offline page (the worker's fallback on a store host), the queued-actions list and the install page are the store's
    expect(hostRewritePath('anand', '/offline')).toBe('/anand/offline');
    expect(hostRewritePath('anand', '/queued')).toBe('/anand/queued');
    expect(hostRewritePath('anand', '/app')).toBe('/anand/app');
    expect(hostRewritePath('anand', '/offline/x')).toBeNull();
  });
  it('the storefront\'s own hosts are never sent to the API', () => {
    expect(isOwnHost('localhost:3001', '')).toBe(true); expect(isOwnHost('127.0.0.1', '')).toBe(true);
    expect(isOwnHost('store.krishalaya.app', 'https://store.krishalaya.app')).toBe(true);
    expect(isOwnHost('mandi.anandfpo.in', 'https://store.krishalaya.app')).toBe(false);
  });
  it('the middleware answers 404 for an unknown host and 301 only when the API says so — never a default tenant', () => {
    const mw = readFileSync(join(SRC, 'middleware.ts'), 'utf8');
    // PC-56 STORE-SWEEP-b · D4: the 404 is small localized HTML now (lib/edge-words.ts — middleware-outage.render.test.tsx renders it through the real middleware)
    expect(mw).toMatch(/if \(!a\.tenant\) return new NextResponse\(edgeHtml\('unknown_host', req\.cookies\.get\(LANG_COOKIE\)\?\.value\), \{ status: 404, headers: edgeHeaders\('unknown_host'\) \}\)/);
    expect(mw).toMatch(/if \(a\.redirectTo\) return NextResponse\.redirect\(/);
  });
});
