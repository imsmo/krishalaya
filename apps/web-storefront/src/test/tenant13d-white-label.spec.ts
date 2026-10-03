// apps/web-storefront/src/test/tenant13d-white-label.spec.ts · PC-56 TENANT-13d · A5 / B3 — the storefront wears the tenant's PUBLISHED
// brand: manifest and metadata are tenant-aware, the colours reach :root only as #rrggbb, "Powered by Krishalaya" follows the one rule
// (never hidden on a trust surface), the one-time note shows once, Host routing rewrites only what it should — and the hard-coded
// "Krishalaya Store" literal is gone from the storefront (the platform name lives in packages/tokens' brand-mark list).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { PublishedBrand, TenantBranding } from '@krishalaya/sdk-js';
import {
  brandCss, brandNoteDecision, brandSeenCookie, brandingForMark, hostRewritePath, logoSrc, platformManifest, poweredByVisible, tenantManifest, PLATFORM_BRAND,
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
  it('only the platform\'s own pages get the platform manifest (from the one brand-mark list)', () => {
    expect(platformManifest('d')).toMatchObject({ name: PLATFORM_BRAND.platformStoreName, short_name: PLATFORM_BRAND.name });
  });
  it('the [tenantSlug] layout sets title, manifest and theme colour from the brand; the root manifest reads the Host-routed tenant', () => {
    const layout = readFileSync(join(SRC, 'app', '[tenantSlug]', 'layout.tsx'), 'utf8');
    expect(layout).toMatch(/manifest: `\/\$\{params\.tenantSlug\}\/manifest\.webmanifest`/);
    expect(layout).toMatch(/title: \{ default: name/); expect(layout).toMatch(/themeColor: brandColours\(b\?\.brand\)\?\.primary/);
    expect(readFileSync(join(SRC, 'app', 'manifest.ts'), 'utf8')).toMatch(/TENANT_SLUG_HEADER/);
  });
  it('the hard-coded "Krishalaya Store" literal is gone from every storefront source file (grep)', () => {
    const offenders = walk(SRC).filter((f) => /\.(ts|tsx|js)$/.test(f) && !f.includes(`${join('src', 'test')}`)).filter((f) => readFileSync(f, 'utf8').includes('Krishalaya Store'));
    expect(offenders).toEqual([]);
    expect(PLATFORM_BRAND.platformStoreName).toBe('Krishalaya Store');   // kept in the brand-mark list, not deleted
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
    for (const page of [['app', 'checkout', 'pay', 'page.tsx'], ['app', 'orders', '[id]', 'page.tsx']]) expect(readFileSync(join(SRC, ...page), 'utf8')).toMatch(/poweredByVisible\('escrow'/);
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
  });
  it('the storefront\'s own hosts are never sent to the API', () => {
    expect(isOwnHost('localhost:3001', '')).toBe(true); expect(isOwnHost('127.0.0.1', '')).toBe(true);
    expect(isOwnHost('store.krishalaya.app', 'https://store.krishalaya.app')).toBe(true);
    expect(isOwnHost('mandi.anandfpo.in', 'https://store.krishalaya.app')).toBe(false);
  });
  it('the middleware answers 404 for an unknown host and 301 only when the API says so — never a default tenant', () => {
    const mw = readFileSync(join(SRC, 'middleware.ts'), 'utf8');
    expect(mw).toMatch(/if \(!a\.tenant\) return new NextResponse\('No organisation is served at this address\.', \{ status: 404 \}\)/);
    expect(mw).toMatch(/if \(a\.redirectTo\) return NextResponse\.redirect\(/);
  });
});
