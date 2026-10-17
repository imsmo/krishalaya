// apps/web-storefront/src/test-render/rtl-store-close.render.test.tsx · PC-56 STORE-CLOSE · the store panel's RTL spot-check (the TENANT close's shape:
// web-tenant's rtl-sweep.render.test.tsx). A representative set of REAL storefront pages, each mounted under dir="rtl" INSIDE ITS REAL CHROME:
//   • the platform chrome (PlatformLayout: SiteHeader, the ribbon, the signal banner, SiteFooter), a store's chrome (TenantLayout: the organisation's
//     header, brand CSS, TenantFooter) and the offline shell (ShellLayout; a store's shell header via x-kv-shell);
//   • the two homes (W273 / W274), a listing (W277), the cart (W278, its "added → now" drift arrow), an order (W289), the four keyset lists whose
//     "Show more" this close moved to DirArrow (orders W288, offers W293, messages W297, the inbox W299), offline (W313), queued (W314), the app
//     page (W319), "On this phone" (W315), Help (W311), the quality promise (W309), Trust & your data (W310), Contact (W312, and a store's), the
//     language page (W323), the boundaries (W316: a store's and the platform's 404 / error inside their chrome; global-error on its own);
// in en, hi and gu. Each asserts (a) it renders (the page's own marker inside the chrome's <main>), (b) no element carries a PHYSICAL-direction class
// or inline style or align attribute, (c) no directional arrow or angle quote (→ ← » « › ‹) outside the flipping `.kv-dir-flip` span. Two static
// backstops cover what a mount cannot see: globals.css has no physical rule, and no .tsx file renders an arrow as JSX text except DirArrow.
//
// HOW (one file, many fixture worlds): every wave's pages read a different mocked world (store6a / sweep / store1b / 2a / 2b / 3a / 3b / 4b / 4c
// fixtures, each already green in its own rtl-store* test). Each world is loaded inside `jest.isolateModulesAsync` with its own `jest.doMock`s, so
// its pages, its React and its renderer are one consistent module graph. The chromes are rendered in the store6a world (the one the boundary and
// both-chromes tests use) with a slot child; a page from another world is rendered in its world and placed in that slot — the same HTML Next
// composes (layout around page). The store6a world's own pages (offline, queued, app, sync, the boundaries) are nested in the chrome directly.
/* eslint-disable @typescript-eslint/no-explicit-any -- worlds are loaded with require() inside isolated registries */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as ts from 'typescript';

type Req = (p: string) => any;
type Factory = () => unknown;

// ── the guards (store1b-harness's, widened to every directional glyph and the align attribute) ─────────────────────────────────────────────────
const PHYSICAL_CLASS = /^-?(?:m[lr]|p[lr]|left|right)-|^(?:text-(?:left|right)|float-(?:left|right))$|^(?:rounded-[lr]|border-[lr])(?:-|$)/;
const PHYSICAL_STYLE = /(?:margin|padding|border)-(?:left|right)|border-(?:top|bottom)-(?:left|right)-radius|(?:^|;)\s*(?:left|right)\s*:|text-align\s*:\s*(?:left|right)|float\s*:\s*(?:left|right)/;
function physical(html: string): string[] {
  const hits: string[] = [];
  for (const m of html.matchAll(/\sclass="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c && PHYSICAL_CLASS.test(c)) hits.push(c);
  for (const m of html.matchAll(/\sstyle="([^"]*)"/g)) if (PHYSICAL_STYLE.test(m[1])) hits.push(`style="${m[1]}"`);
  for (const m of html.matchAll(/\salign="(left|right)"/g)) hits.push(`align="${m[1]}"`);
  return hits;
}
const ARROWS = /[→←»«›‹]/g;
/** directional glyphs left in the markup once every flipping DirArrow span is taken out (<style>/<script> bodies are not rendered text) */
const bareArrows = (html: string) => (html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<span class="kv-dir-flip">→<\/span>/g, '').match(ARROWS) ?? []);
/** the chrome's <main> (the page's slot) — a marker found here is the page's own, never the header's or the footer's */
const inMain = (html: string) => html.slice(html.indexOf('<main'), html.lastIndexOf('</main>'));

// ── the worlds ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const ENV = { env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: 'rzp_test_x' } };
const nav = (actual = false) => () => ({
  ...(actual ? jest.requireActual('next/navigation') : {}),
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
  usePathname: () => '/', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }),
});
/** lib/i18n bound to a world's own language field (the catalogues are the real ones) */
const i18nOn = (fixture: string, field: (f: any) => string) => () => {
  const { Translator: Tr, resolveLanguage } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual(fixture);
  return {
    LANG_COOKIE: 'kv_lang', getLang: () => field(f), getLanguageDef: () => resolveLanguage(field(f)),
    getTranslator: () => new Tr(field(f)).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')),
  };
};
const formStatus = (fixture: string) => () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: jest.requireActual(fixture).C.pending === true }) });

// every path any world mocks (a world first clears all of them, then mocks its own — so nothing leaks from the world before it)
const MOCKED = ['next/headers', 'next/navigation', 'next/cache', 'react-dom', '../lib/env', '../lib/i18n', '../lib/session', '../lib/auth', '../lib/api-client',
  '../lib/storefront-data', '../features/cart/summary', '../app/(platform)/login/actions', '../app/[tenantSlug]/cart/actions'];

async function inWorld<T>(mocks: Record<string, Factory>, run: (req: Req) => Promise<T>): Promise<T> {
  let out: T | undefined;
  await jest.isolateModulesAsync(async () => {
    for (const p of MOCKED) jest.dontMock(p);
    jest.doMock('server-only', () => ({}), { virtual: true });
    for (const [p, f] of Object.entries(mocks)) jest.doMock(p, f);
    out = await run((p: string) => require(p));
  });
  return out as T;
}
/** the world's own renderer (its React) over its own resolveTree — so hooks and async server components resolve in one graph */
const renderer = (req: Req, asyncTypes: any[] = []) => {
  const { renderToStaticMarkup } = req('react-dom/server');
  const { resolveTree } = req('./store1b-harness');
  return async (node: unknown): Promise<string> => renderToStaticMarkup(await resolveTree(node, asyncTypes));
};

// the store6a world — the chromes, the offline shell, offline / queued / app / sync, the boundaries (store-boundaries.render.test.tsx's mocks)
const W6: Record<string, Factory> = {
  'next/headers': () => { const f = jest.requireActual('./store6a-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; },
  'next/navigation': nav(),
  '../lib/env': () => ENV,
  '../app/(platform)/login/actions': () => ({ logoutAction: async () => undefined }),
  '../lib/api-client': () => { const f = jest.requireActual('./store6a-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient, sessionTenantClient: () => f.publicClient() }; },
  '../lib/storefront-data': () => { const f = jest.requireActual('./store6a-fixtures'); return { loadTenantShell: f.loadTenantShell }; },
};
const LANGS = ['en', 'hi', 'gu'] as const;
type Lang = typeof LANGS[number];
type Chrome = 'platform' | 'store';
const SLOT = '<i data-kv-slot="page"></i>';
const SLUG = 'anand-fpo';
const CHROMES = new Map<string, string>();   // `${chrome}:${lang}` → the chrome's markup with the slot

beforeAll(async () => {
  await inWorld(W6, async (req) => {
    const f = req('./store6a-fixtures');
    const React = req('react');
    const PlatformLayout = req('../app/(platform)/layout').default;
    const TenantLayout = req('../app/[tenantSlug]/layout').default;
    const render = renderer(req, [req('../components/SiteHeader').SiteHeader, req('../components/TenantHeader').TenantHeader]);
    const slot = React.createElement('i', { 'data-kv-slot': 'page' });
    for (const l of LANGS) {
      f.reset(); f.withCookies({ kv_lang: l });
      CHROMES.set(`platform:${l}`, await render(await PlatformLayout({ children: slot })));
      CHROMES.set(`store:${l}`, await render(await TenantLayout({ children: slot, params: { tenantSlug: SLUG } })));
    }
  });
});
/** a page from another world placed in its chrome, under dir="rtl" */
const inChrome = (chrome: Chrome, lang: Lang, page: string) => {
  const c = CHROMES.get(`${chrome}:${lang}`)!;
  expect(c).toContain(SLOT);
  expect(inMain(c)).not.toMatch(/<h1|data-kv-boundary=|data-kv-offline=/);   // the chrome alone carries no page marker
  return `<div dir="rtl">${c.replace(SLOT, page)}</div>`;
};

type Case = [name: string, chrome: Chrome, make: () => Promise<unknown> | unknown, marker: string | RegExp];
/** mount each case in each language: renders (its marker, inside <main>), no physical class/style, no bare arrow */
async function check(cases: Case[], setLang: (l: Lang) => void, render: (n: unknown) => Promise<string>, reset: () => void, seen: Map<string, string>) {
  for (const l of LANGS) {
    for (const [name, chrome, make, marker] of cases) {
      reset(); setLang(l);
      const html = inChrome(chrome, l, await render(await make()));
      expect([name, l, inMain(html)]).toEqual([name, l, expect.stringMatching(marker)]);   // the page itself, not the chrome
      expect(html).toMatch(/<main class="kv-container" id="main"/);
      expect([name, l, physical(html)]).toEqual([name, l, []]);
      expect([name, l, bareArrows(html)]).toEqual([name, l, []]);
      seen.set(`${name}:${l}`, html);
    }
  }
}

describe('the guards bite (so a pass below means something)', () => {
  it('flags physical classes, styles and align; every directional glyph outside the flip span; passes logical markup', () => {
    expect(physical('<p class="ml-2 pr-4 text-right rounded-l-md border-r float-left left-0"></p>')).toHaveLength(7);
    expect(physical('<p style="margin-left:4px"></p><p style="text-align:right"></p><p style="right: 0"></p><p style="border-top-left-radius:4px"></p><td align="left"></td>')).toHaveLength(5);
    expect(physical('<p class="ms-2 pe-4 text-start kv-btn--link kv-crumb kv-dir-flip" style="margin-inline-start:4px;text-align:center;width:40%"></p>')).toEqual([]);
    expect(bareArrows('Show more →')).toEqual(['→']);
    expect(bareArrows('« ‹ Prev / Next › »')).toEqual(['«', '‹', '›', '»']);
    expect(bareArrows('Show more <span class="kv-dir-flip">→</span>')).toEqual([]);
    expect(bareArrows('<style>.a::before{content:"›"}</style><p>x</p>')).toEqual([]);
  });
});

describe('STORE-CLOSE · rtl · the store6a world (nested in the real chrome)', () => {
  it('offline (both chromes, the shell), queued, the app page, "On this phone", the boundaries — en / hi / gu', async () => {
    await inWorld(W6, async (req) => {
      const f = req('./store6a-fixtures');
      const React = req('react');
      const h = (type: any, props: any = {}) => React.createElement(type, props);
      const PlatformLayout = req('../app/(platform)/layout').default;
      const TenantLayout = req('../app/[tenantSlug]/layout').default;
      const ShellLayout = req('../app/(shell)/layout').default;
      const render = renderer(req, [req('../components/SiteHeader').SiteHeader, req('../components/TenantHeader').TenantHeader]);
      const P = (child: unknown) => PlatformLayout({ children: child });
      const T = (child: unknown) => TenantLayout({ children: child, params: { tenantSlug: SLUG } });
      const err = Object.assign(new Error('boom'), { digest: '4182937' });
      const pg = (p: string) => req(p).default;
      const cases: Array<[string, () => Promise<unknown>, string | RegExp, () => void]> = [
        ['/offline in the shell', async () => ShellLayout({ children: pg('../app/(shell)/offline/page')({ searchParams: {} }) }), 'data-kv-offline="shell"', () => undefined],
        ['/<slug>/offline in the store\'s shell header', async () => T(pg('../app/[tenantSlug]/offline/page')({ params: { tenantSlug: SLUG }, searchParams: {} })), 'data-kv-offline=', () => { f.C.headers = { 'x-kv-shell': 'offline' }; }],
        ['/queued', async () => P(pg('../app/(platform)/queued/page')()), /<h1/, () => undefined],
        ['/<slug>/queued', async () => T(pg('../app/[tenantSlug]/queued/page')({ params: { tenantSlug: SLUG } })), /<h1/, () => undefined],
        ['/app', async () => P(pg('../app/(platform)/app/page')({})), /<h1/, () => undefined],
        ['/<slug>/app', async () => T(pg('../app/[tenantSlug]/app/page')({ params: { tenantSlug: SLUG } })), /<h1/, () => undefined],
        ['/sync', async () => P(pg('../app/(platform)/sync/page')({ searchParams: {} })), /<h1/, () => undefined],
        ['/<slug>/sync', async () => T(pg('../app/[tenantSlug]/sync/page')({ params: { tenantSlug: SLUG }, searchParams: {} })), /<h1/, () => undefined],
        ['a store\'s 404', async () => T(h(pg('../app/[tenantSlug]/not-found'))), 'data-kv-boundary="not_found"', () => undefined],
        ['a store\'s error', async () => T(h(pg('../app/[tenantSlug]/error'), { error: err, reset: () => undefined })), 'data-kv-boundary="error"', () => undefined],
        ['the platform\'s 404', async () => P(h(pg('../app/(platform)/not-found'))), 'data-kv-boundary="not_found"', () => undefined],
        ['the platform\'s error', async () => P(h(pg('../app/(platform)/error'), { error: err, reset: () => undefined })), 'data-kv-boundary="error"', () => undefined],
      ];
      for (const l of LANGS) {
        for (const [name, make, marker, arrange] of cases) {
          f.reset(); f.C.flags = { storefront_offline_reads: true, storefront_pwa: true, storefront_install_prompt: true }; f.withCookies({ kv_lang: l }); arrange();
          const html = `<div dir="rtl">${await render(await make())}</div>`;
          expect([name, l, inMain(html)]).toEqual([name, l, expect.stringMatching(marker)]);   // the page itself, not the chrome
          expect(html).toMatch(/<main class="kv-container" id="main"/);
          expect([name, l, physical(html)]).toEqual([name, l, []]);
          expect([name, l, bareArrows(html)]).toEqual([name, l, []]);
        }
        // global-error: its own <html lang dir>, no chrome
        f.reset(); f.withCookies({ kv_lang: l });
        const g = await render(h(pg('../app/global-error'), { error: err, reset: () => undefined }));
        expect(g).toMatch(/^<html lang="[a-z]+" dir="ltr">/);   // ar / ur are not live: resolveLanguage never answers rtl today — the attribute is wired from the def
        expect(physical(g)).toEqual([]);
        expect(bareArrows(g)).toEqual([]);
      }
    });
  });
});

describe('STORE-CLOSE · rtl · pages from the other worlds, inside their chrome', () => {
  it('Help, the quality promise, Trust & your data, Contact (and a store\'s), the language page — both chromes (sweep world)', async () => {
    await inWorld({
      'next/headers': () => { const f = jest.requireActual('./sweep-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; },
      'next/navigation': nav(),
      '../lib/env': () => ENV,
      '../lib/api-client': () => { const f = jest.requireActual('./sweep-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient }; },
      '../lib/storefront-data': () => { const f = jest.requireActual('./sweep-fixtures'); return { loadTenantShell: f.loadTenantShell }; },
    }, async (req) => {
      const f = req('./sweep-fixtures');
      const pg = (p: string) => req(p).default;
      const params = { tenantSlug: SLUG };
      await check([
        ['W311 Help', 'platform', () => pg('../app/(platform)/help/page')(), /<h1/],
        ['W311 a store\'s Help', 'store', () => pg('../app/[tenantSlug]/help/page')({ params }), /<h1/],
        ['W309 the quality promise', 'platform', () => pg('../app/(platform)/quality-promise/page')(), 'data-kv-quality-section="rules"'],
        ['W309 a store\'s quality promise', 'store', () => pg('../app/[tenantSlug]/quality-promise/page')({ params }), 'data-kv-quality-section="rules"'],
        ['W310 Trust & your data', 'platform', () => pg('../app/(platform)/trust-data/page')(), 'data-kv-mechanism='],
        ['W312 Contact', 'platform', () => pg('../app/(platform)/contact/page')(), /<h1/],
        ['a store\'s contact page', 'store', () => pg('../app/[tenantSlug]/contact/page')({ params }), /<h1/],
        ['W323 the language page', 'platform', () => pg('../app/(platform)/language/page')({ searchParams: {} }), 'name="lang"'],
        ['W323 a store\'s language page', 'store', () => pg('../app/[tenantSlug]/language/page')({ params, searchParams: {} }), 'name="lang"'],
      ], (l) => { f.S.lang = l; }, renderer(req), f.reset, new Map());
    });
  });

  it('the two homes (W273 platform, W274 a store, with "Show more") — store1b world', async () => {
    const M = { lang: 'en' };
    const CARD = { listingId: 'l1', tenantSlug: SLUG, organisation: 'Anand FPO', title: 'Groundnut', priceMinor: '615000', currencyCode: 'INR', unitCode: 'quintal', organic: true, grade: 'Grade A', district: 'Junagadh' };
    const LISTING = { id: 'x1', title: 'Wheat', priceMinor: '256000', currencyCode: 'INR', unitCode: 'quintal', quantityAvailable: 4, organicClaim: false, saleType: 'direct', regionId: null, sellerUserId: 's', boosted: false };
    await inWorld({
      'next/navigation': nav(true),
      'next/headers': () => ({ headers: () => new Headers(), cookies: () => ({ get: () => undefined, has: () => false }) }),
      '../lib/env': () => ENV,
      '../lib/i18n': () => {
        const { Translator: Tr, resolveLanguage } = jest.requireActual('@krishalaya/i18n');
        const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
        return { getLang: () => M.lang, getLanguageDef: () => resolveLanguage(M.lang), getTranslator: () => new Tr(M.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
      },
      '../lib/auth': () => ({ hasSessionCookie: () => false }),
      '../features/cart/summary': () => ({ getCartItemCount: async () => 2 }),
      '../lib/storefront-data': () => ({
        loadTenantShell: async () => ({ kind: 'ok', tenant: { tenantId: 't', slug: SLUG, displayName: 'Anand FPO', countryCode: null, defaultLang: null, phoneDefaultCountry: 'IN' }, branding: { displayName: 'Anand FPO', logoUrl: null, brand: null } }),
        loadTenantProfile: async () => ({ ok: true, data: { displayName: 'Anand FPO', legalName: 'Anand FPO Ltd', verified: true, sinceYear: 2019, district: 'Anand', memberFarmers: 12, logoUrl: null, logoPath: null, currencyCode: 'INR' } }),
      }),
      '../lib/api-client': () => ({
        publicClient: () => ({
          storefront: {
            stats: async () => ({ liveListings: 3, verifiedOrganisations: 2, districts: 1, computedAt: new Date(Date.now() - 2 * 3600_000).toISOString() }),
            discover: async () => ({ items: [CARD], nextCursor: 'C2' }),
            organisations: async () => ({ items: [{ slug: SLUG, displayName: 'Anand FPO', district: 'Anand', logoUrl: null, logoPath: null, memberFarmers: 12 }], nextCursor: 'C2' }),
            flags: async () => ({ group_lots: false }),
          },
          listings: { browse: async () => ({ items: [LISTING], nextCursor: 'C2', total: 1, totalCap: 1000, membersOnlyCount: 2 }),
            search: async () => ({ items: [LISTING], nextCursor: 'C2', total: 1, totalCap: 1000, membersOnlyCount: 2, facets: null }) },
          lookups: { categories: async () => [], regions: async () => [] },
        }),
      }),
    }, async (req) => {
      const pg = (p: string) => req(p).default;
      const seen = new Map<string, string>();
      await check([
        ['W273 the platform home', 'platform', () => pg('../app/(platform)/page')(), /<h1/],
        ['W274 a store\'s home', 'store', () => pg('../app/[tenantSlug]/page')({ params: { tenantSlug: SLUG }, searchParams: {} }), /<h1/],
      ], (l) => { M.lang = l; }, renderer(req), () => undefined, seen);
      expect(seen.get('W274 a store\'s home:en')).toMatch(/Show more <span class="kv-dir-flip">→<\/span>/);
    });
  });

  it('a listing (W277) — store2a world', async () => {
    await inWorld({
      '../lib/session': () => ({ requireSession: async () => 'tok' }),
      '../app/(platform)/login/actions': () => ({ logoutAction: async () => undefined }),
      'next/navigation': nav(true),
      '../lib/env': () => ENV,
      '../lib/i18n': i18nOn('./store2a-fixtures', (f) => f.S.lang),
      '../lib/auth': () => ({ hasSessionCookie: () => false }),
      '../features/cart/summary': () => ({ getCartItemCount: async () => 0 }),
      '../lib/storefront-data': () => {
        const f = jest.requireActual('./store2a-fixtures');
        return {
          loadTenantShell: async () => ({ kind: 'ok', tenant: { tenantId: f.T, slug: SLUG, displayName: 'Anand FPO', countryCode: null, defaultLang: null, phoneDefaultCountry: 'IN' }, branding: { displayName: 'Anand FPO', logoUrl: null, brand: null } }),
          loadTenantProfile: async () => ({ ok: true, data: f.S.profile }),
        };
      },
      '../lib/api-client': () => { const f = jest.requireActual('./store2a-fixtures'); return { publicClient: () => f.apiClient() }; },
    }, async (req) => {
      const f = req('./store2a-fixtures');
      await check([
        ['W277 the lot', 'store', () => req('../app/[tenantSlug]/listings/[id]/page').default({ params: { tenantSlug: SLUG, id: f.L1 }, searchParams: {} }), /<h1/],
      ], (l) => { f.S.lang = l; }, renderer(req), f.reset, new Map());
    });
  });

  it('the cart (W278, a changed price → its drift arrow flips) — store2b world', async () => {
    await inWorld({
      'next/navigation': nav(true),
      '../lib/env': () => ENV,
      '../lib/i18n': i18nOn('./store2b-fixtures', (f) => f.W.lang),
      '../lib/session': () => { const f = jest.requireActual('./store2b-fixtures'); return { resolveSessionToken: async () => f.W.token, requireSession: async () => 'tok' }; },
      '../lib/auth': () => { const f = jest.requireActual('./store2b-fixtures'); return { getSessionTenant: () => f.W.sessionTenant, hasSessionCookie: () => true }; },
      '../lib/storefront-data': () => { const f = jest.requireActual('./store2b-fixtures'); return { loadTenantShell: (s: string) => f.shell(s) }; },
      '../lib/api-client': () => { const f = jest.requireActual('./store2b-fixtures'); return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient }; },
      '../app/[tenantSlug]/cart/actions': () => ({ updateCartLineAction: async () => undefined, removeCartLineAction: async () => undefined, acceptPriceAction: async () => undefined }),
    }, async (req) => {
      const f = req('./store2b-fixtures');
      const seen = new Map<string, string>();
      await check([
        ['W278 the cart', 'store', () => req('../app/[tenantSlug]/cart/page').default({ params: { tenantSlug: SLUG }, searchParams: {} }), 'data-kv-price="added"'],
      ], (l) => { f.W.lang = l; }, renderer(req), () => { f.reset(); f.W.cart = { items: [f.LINE(f.ID.ok), f.DRIFT], subtotalMinor: '8198000', currencyCode: 'INR' }; }, seen);
      for (const l of LANGS) expect(seen.get(`W278 the cart:${l}`)).toMatch(/data-kv-price="added">[^<]+<\/span> <span class="kv-dir-flip">→<\/span>/);
    });
  });

  it('an order (W289) and the order list with a next page (W288) — store3a world', async () => {
    await inWorld({
      'next/navigation': nav(),
      'next/cache': () => ({ revalidatePath: () => undefined }),
      'next/headers': () => ({ cookies: () => jest.requireActual('./store3a-fixtures').cookieJar() }),
      'react-dom': formStatus('./store3a-fixtures'),
      '../lib/env': () => ENV,
      '../lib/i18n': i18nOn('./store3a-fixtures', (f) => f.C.lang),
      '../lib/session': () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }),
      '../lib/auth': () => ({ getSessionTenant: () => 't' }),
      '../lib/api-client': () => { const f = jest.requireActual('./store3a-fixtures'); return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient }; },
    }, async (req) => {
      const f = req('./store3a-fixtures');
      const seen = new Map<string, string>();
      const params = { tenantSlug: SLUG };
      await check([
        ['W288 the orders, a next page', 'store', () => req('../app/[tenantSlug]/orders/page').default({ params, searchParams: {} }), 'rel="next"'],
        ['W289 the order (delivered, paid)', 'store', () => req('../app/[tenantSlug]/orders/[id]/page').default({ params: { ...params, id: f.OID.paid }, searchParams: {} }), /<h1/],
      ], (l) => { f.C.lang = l; }, renderer(req), () => {
        f.reset();
        f.C.list.all = [f.ROW(f.OID.cod, 'confirmed'), f.ROW(f.OID.paid, 'delivered', { paymentState: 'paid' })]; f.C.next = 'CUR2';
        f.C.orders[f.OID.paid] = f.DETAIL(f.OID.paid, { status: 'delivered', paymentState: 'paid', qualityWindowEnds: '2026-10-16T12:00:00.000Z' });
        f.C.events[f.OID.paid] = [{ toStatus: 'created', actorRole: 'buyer', at: '2026-10-15T11:42:00.000Z' }, { toStatus: 'delivered', actorRole: 'seller', at: '2026-10-15T15:00:00.000Z' }];
      }, seen);
      expect(seen.get('W288 the orders, a next page:en')).toMatch(/rel="next"[^>]*>Show more <span class="kv-dir-flip">→<\/span><\/a>/);
      expect(seen.get('W288 the orders, a next page:hi')).toMatch(/rel="next"[^>]*>और दिखाएँ <span class="kv-dir-flip">→<\/span><\/a>/);
    });
  });

  it('the offers with a next page (W293) — store3b world', async () => {
    await inWorld({
      'next/navigation': nav(),
      'next/cache': () => ({ revalidatePath: () => undefined }),
      'next/headers': () => ({ cookies: () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) }),
      'react-dom': formStatus('./store3b-fixtures'),
      '../lib/env': () => ENV,
      '../lib/i18n': i18nOn('./store3b-fixtures', (f) => f.C.lang),
      '../lib/session': () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }),
      '../lib/auth': () => ({ getSessionTenant: () => 't', hasSessionCookie: () => true }),
      '../lib/api-client': () => { const f = jest.requireActual('./store3b-fixtures'); return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient }; },
    }, async (req) => {
      const f = req('./store3b-fixtures');
      const seen = new Map<string, string>();
      await check([
        ['W293 the offers, a next page', 'store', () => req('../app/[tenantSlug]/offers/page').default({ params: { tenantSlug: SLUG }, searchParams: {} }), 'rel="next"'],
      ], (l) => { f.C.lang = l; }, renderer(req), () => { f.reset(); f.C.list.all = [f.OFFER(f.OFF.countered)]; f.C.next = 'N2'; }, seen);
      expect(seen.get('W293 the offers, a next page:en')).toMatch(/rel="next"[^>]*>Show more <span class="kv-dir-flip">→<\/span><\/a>/);
    });
  });

  it('the messages with a next page (W297) — store4b world', async () => {
    await inWorld({
      'next/navigation': nav(),
      'next/cache': () => ({ revalidatePath: () => undefined }),
      '../lib/env': () => ENV,
      '../lib/i18n': i18nOn('./store4b-fixtures', (f) => f.C.lang),
      '../lib/session': () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }),
      '../lib/api-client': () => { const f = jest.requireActual('./store4b-fixtures'); return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient }; },
    }, async (req) => {
      const f = req('./store4b-fixtures');
      const seen = new Map<string, string>();
      await check([
        ['W297 the messages, a next page', 'store', () => req('../app/[tenantSlug]/messages/page').default({ params: { tenantSlug: SLUG }, searchParams: {} }), 'data-kv-next'],
      ], (l) => { f.C.lang = l; }, renderer(req), () => { f.reset(); f.C.nextCursor = 'MjAyNnww'; }, seen);
      expect(seen.get('W297 the messages, a next page:en')).toMatch(/data-kv-next="true" href="[^"]*">Show more <span class="kv-dir-flip">→<\/span><\/a>/);
    });
  });

  it('the inbox with a next page (W299) — store4c world', async () => {
    await inWorld({
      'next/navigation': nav(),
      'next/cache': () => ({ revalidatePath: () => undefined }),
      'next/headers': () => ({ cookies: () => jest.requireActual('./store4c-fixtures').cookieJar() }),
      '../lib/env': () => ENV,
      '../lib/i18n': i18nOn('./store4c-fixtures', (f) => f.C.lang),
      '../lib/session': () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }),
      '../lib/api-client': () => { const f = jest.requireActual('./store4c-fixtures'); return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient }; },
    }, async (req) => {
      const f = req('./store4c-fixtures');
      const seen = new Map<string, string>();
      await check([
        ['W299 the inbox, a next page', 'store', () => req('../app/[tenantSlug]/notifications/page').default({ params: { tenantSlug: SLUG }, searchParams: {} }), 'data-kv-next'],
      ], (l) => { f.C.lang = l; }, renderer(req), () => { f.reset(); f.C.nextCursor = 'MjAyNnxu'; }, seen);
      expect(seen.get('W299 the inbox, a next page:en')).toMatch(/data-kv-next="true" href="[^"]*">Show more <span class="kv-dir-flip">→<\/span><\/a>/);
    });
  });
});

describe('STORE-CLOSE · rtl · the static backstops (what a mount cannot see)', () => {
  const SRC = join(__dirname, '..');
  it('globals.css: logical properties only — the one transform is the [dir="rtl"] flip of .kv-dir-flip', () => {
    const css = readFileSync(join(SRC, 'styles', 'globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css.match(/(?:margin|padding|border)-(?:left|right)\b|border-(?:top|bottom)-(?:left|right)-radius|(?:^|[;{\s])(?:left|right)\s*:|text-align\s*:\s*(?:left|right)|float\s*:\s*(?:left|right)/g)).toBeNull();
    const asym = [...css.matchAll(/border-radius\s*:\s*([^;}]+)/g)].map((m) => m[1].trim().split(/\s+/)).filter((v) => v.length > 1 && new Set(v).size > 1);
    expect(asym).toEqual([]);   // a per-corner shorthand names physical corners
    expect(css.match(/(?<![-\w])transform\s*:[^;}]*/g)).toEqual(['transform: scaleX(-1)']);
    expect(css).toMatch(/\[dir="rtl"\] \.kv-dir-flip \{ display: inline-block; transform: scaleX\(-1\); \}/);
  });
  it('no .tsx renders a directional glyph as JSX text, and no inline style names a physical side — except DirArrow itself', () => {
    const hits: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) { if (!/^(test|test-render)$/.test(n)) walk(p); } else if (p.endsWith('.tsx')) scan(p); } };
    const scan = (p: string) => {
      const sf = ts.createSourceFile(p, readFileSync(p, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (n: ts.Node): void => {
        if (n.kind === ts.SyntaxKind.JsxText && /[→←»«›‹]/.test(n.getText(sf))) hits.push(`${relative(SRC, p)}: ${n.getText(sf).trim()}`);
        // a `style={{ … }}` object: no physical side, no left/right alignment
        if (ts.isJsxAttribute(n) && n.name.getText(sf) === 'style') {
          const s = n.initializer?.getText(sf) ?? '';
          if (/\b(?:margin|padding|border)(?:Left|Right)\b|[{,\s](?:left|right|float)\s*:|textAlign\s*:\s*'(?:left|right)'/.test(s)) hits.push(`${relative(SRC, p)}: style=${s}`);
        }
        // a column's `align` (DataTable): start / end / center only
        if (ts.isPropertySignature(n) && n.name.getText(sf) === 'align' && /'(?:left|right)'/.test(n.type?.getText(sf) ?? '')) hits.push(`${relative(SRC, p)}: ${n.getText(sf)}`);
        ts.forEachChild(n, visit);
      };
      visit(sf);
    };
    walk(SRC);
    expect(hits).toEqual(['components/DirArrow.tsx: →']);
  });
});
