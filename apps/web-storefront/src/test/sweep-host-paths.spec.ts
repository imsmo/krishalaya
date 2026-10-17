// apps/web-storefront/src/test/sweep-host-paths.spec.ts · PC-56 STORE-SWEEP-a · C1 / C3 (founders D3 / D4) — WHICH PAGES ARE WHOSE, AS PURE RULES.
//   • a store's OWN host REWRITES `/help`, `/quality-promise`, `/contact` to the store's pages (brand-theme.ts `hostRewritePath`) — mutant M3 (`/help`
//     dropped) turns this red;
//   • it REDIRECTS `/about`, `/press`, `/pricing`, `/blog`, `/trust-data` (and paths under them) to the platform origin's same path — mutant M6
//     (`/about` dropped from PLATFORM_ONLY_PATHS) turns this red; `/contact` and `/help` are NEVER redirected (they are the store's own);
//   • with no usable platform origin nothing is redirected (a redirect to nowhere would loop);
//   • the Grievances link and "Powered by" always reach the PLATFORM's pages — same origin on a path store, the platform origin on a host store;
//   • the new top-level routes are static segments (never a tenant slug).
// PC-56 STORE-SWEEP-b (founders D3 / D5): `/language` and the trace ENTRY `/trace` (exactly) are rewritten to the store's own pages on its host;
// `/for-organisations` (and paths under it) answer the platform origin (mutant M6 — dropped from PLATFORM_ONLY_PATHS — turns this red); `language` is
// a static segment.
import { hostRewritePath } from '../features/branding/brand-theme';
import { STATIC_TOP_SEGMENTS, tenantSlugOfPath } from '../features/auth/redirect';
import { PLATFORM_CHROME, tenantChrome } from '../features/store4a/account';
import {
  PLATFORM_ONLY_PATHS, STORE_HOST_REWRITES, SWEEP_BOTH_CHROMES, grievancesHref, platformAboutHref, platformOnlyRedirect, platformOriginOf, sweepHref,
} from '../features/sweep/paths';

const ORIGIN = 'https://bazaar.example.test';

describe('STORE-SWEEP-a · the host rule', () => {
  it('a store host rewrites /help, /quality-promise and /contact to the store\'s own pages', () => {
    expect(hostRewritePath('anand', '/help')).toBe('/anand/help');
    expect(hostRewritePath('anand', '/quality-promise')).toBe('/anand/quality-promise');
    expect(hostRewritePath('anand', '/contact')).toBe('/anand/contact');
    for (const p of STORE_HOST_REWRITES) expect(hostRewritePath('anand', p)).toBe(`/anand${p}`);
    expect(hostRewritePath('anand', '/about')).toBeNull();          // the platform's — redirected, never rewritten
    expect(hostRewritePath('anand', '/trust-data')).toBeNull();
  });

  it('the five platform-only pages answer the platform origin\'s same path (a 307 in the middleware)', () => {
    for (const p of ['/about', '/press', '/pricing', '/blog', '/trust-data']) expect([p, platformOnlyRedirect(p, ORIGIN)]).toEqual([p, `${ORIGIN}${p}`]);
    expect(platformOnlyRedirect('/about/', ORIGIN)).toBe(`${ORIGIN}/about/`);
    expect(platformOnlyRedirect('/blog/some-post', ORIGIN)).toBe(`${ORIGIN}/blog/some-post`);
    expect(platformOnlyRedirect('/about', `${ORIGIN}/some/path`)).toBe(`${ORIGIN}/about`);   // an origin, never a path
  });

  it('/contact and /help (and every other path) are NEVER redirected — /contact on a store host is the store\'s page', () => {
    for (const p of ['/contact', '/help', '/quality-promise', '/', '/listings/x', '/trace', '/trace/ABC', '/aboutus', '/press-kit', '/cart', '/offline']) {
      expect([p, platformOnlyRedirect(p, ORIGIN)]).toEqual([p, null]);
    }
    expect(PLATFORM_ONLY_PATHS).toContain('/contact');               // the PLATFORM's contact page exists — but a store host rewrites the path
  });

  it('no usable platform origin → no redirect (never a loop to nowhere)', () => {
    for (const o of ['', '   ', 'not a url', 'ftp://bazaar.example.test', null, undefined]) expect(platformOnlyRedirect('/about', o)).toBeNull();
    expect(platformOriginOf(`${ORIGIN}/x?y=1`)).toBe(ORIGIN);
  });

  it('the registry: both-chromes pages and the platform-only list', () => {
    // PC-56 STORE-SWEEP-b: + `language` (both chromes, D3); + `/for-organisations` platform-only (D5); + `/language`, `/trace` rewritten on a store host
    expect([...SWEEP_BOTH_CHROMES]).toEqual(['help', 'quality-promise', 'contact', 'language']);
    expect([...PLATFORM_ONLY_PATHS].sort()).toEqual(['/about', '/blog', '/contact', '/for-organisations', '/press', '/pricing', '/trust-data']);
    expect([...STORE_HOST_REWRITES]).toEqual(['/help', '/quality-promise', '/contact', '/language', '/trace']);
  });
});

describe('STORE-SWEEP-a · the links', () => {
  it('sweepHref: /<slug>/<page> under a store, /<page> on the platform', () => {
    expect(sweepHref(tenantChrome('anand'), 'help')).toBe('/anand/help');
    expect(sweepHref(tenantChrome('anand'), 'quality-promise')).toBe('/anand/quality-promise');
    expect(sweepHref(tenantChrome('anand'), 'contact')).toBe('/anand/contact');
    expect(sweepHref(PLATFORM_CHROME, 'help')).toBe('/help');
  });
  it('Grievances and "Powered by" reach the PLATFORM: same origin on a path store, the platform origin on a store host', () => {
    expect(grievancesHref(tenantChrome('anand'), '')).toBe('/trust-data#grievances');
    expect(grievancesHref(tenantChrome('anand'), ORIGIN)).toBe(`${ORIGIN}/trust-data#grievances`);
    expect(grievancesHref(PLATFORM_CHROME, ORIGIN)).toBe('/trust-data#grievances');
    expect(platformAboutHref(tenantChrome('anand'), '')).toBe('/about');
    expect(platformAboutHref(tenantChrome('anand'), ORIGIN)).toBe(`${ORIGIN}/about`);
  });
  it('the three new top-level routes are static segments, never a tenant slug', () => {
    for (const s of ['quality-promise', 'trust-data', 'contact', 'help', 'about']) {
      expect(STATIC_TOP_SEGMENTS).toContain(s);
      expect(tenantSlugOfPath(`/${s}`)).toBeNull();
    }
  });
});

describe('STORE-SWEEP-b · the host rule (founders D3 / D5)', () => {
  it('a store host rewrites /language and the trace entry /trace to the store\'s own pages; /trace/<token> as before', () => {
    expect(hostRewritePath('anand', '/language')).toBe('/anand/language');
    expect(hostRewritePath('anand', '/trace')).toBe('/anand/trace');
    expect(hostRewritePath('anand', '/trace/KVTR9J4K2M')).toBe('/anand/trace/KVTR9J4K2M');
    expect(hostRewritePath('anand', '/trace/')).toBe('/anand/trace/');           // the 5b prefix rule, unchanged
    expect(hostRewritePath('anand', '/languages')).toBeNull();
    expect(hostRewritePath('anand', '/for-organisations')).toBeNull();          // the platform's — redirected, never rewritten
  });
  it('/for-organisations (and anything under it) answers the platform origin; /language and /trace never do', () => {
    expect(platformOnlyRedirect('/for-organisations', ORIGIN)).toBe(`${ORIGIN}/for-organisations`);
    expect(platformOnlyRedirect('/for-organisations/', ORIGIN)).toBe(`${ORIGIN}/for-organisations/`);
    expect(platformOnlyRedirect('/for-organisations?x=1'.split('?')[0], ORIGIN)).toBe(`${ORIGIN}/for-organisations`);
    for (const p of ['/language', '/trace', '/for-organisationsx', '/organisations']) expect([p, platformOnlyRedirect(p, ORIGIN)]).toEqual([p, null]);
    expect(platformOnlyRedirect('/for-organisations', '')).toBeNull();
  });
  it('the language page under both chromes; `language` is a static segment, never a tenant slug', () => {
    expect(sweepHref(tenantChrome('anand'), 'language')).toBe('/anand/language');
    expect(sweepHref(PLATFORM_CHROME, 'language')).toBe('/language');
    expect(STATIC_TOP_SEGMENTS).toContain('language');
    expect(tenantSlugOfPath('/language')).toBeNull();
    expect(tenantSlugOfPath('/anand/language')).toBe('anand');
  });
});
