// apps/web-storefront/src/test-render/rtl-ar.render.test.tsx · PC-56 RTL-1c · THE PROOF for the storefront (web-tenant's RTL-1b rtl-ar.render, adapted).
//
// What every earlier storefront rtl test did NOT do: render real ARABIC copy, with `dir` coming from the app's OWN language resolution — not a
// hand-placed <div dir="rtl">, and not a mocked lib/i18n. Here only the request is faked (`next/headers`: the `kv_lang` cookie, the Accept-Language
// header, the middleware's request headers); the REAL `lib/i18n` resolves the language, the REAL root layout draws <html lang dir> and the
// machine-draft banner, the REAL store layout draws the chrome (TenantHeader with the language picker, TenantFooter), and the REAL pages are mounted
// inside: the store's catalogue (`/[tenantSlug]` — the listing cards), a product page (`/[tenantSlug]/listings/[id]`) and the cart summary
// (`/[tenantSlug]/cart` — line totals, the subtotal and a changed price with its signed delta). Data comes from the existing SDK-shaped fixtures.
//
// Asserted (founder Q1/Q2/Q4 + the lead's money shape, brief_rtl1c.md §D):
//   1. resolution — cookie `ar` → Arabic, rtl; Accept-Language `ar` → ENGLISH (opt-in only); en/hi/gu unchanged;
//   2. the shell — <html lang="ar" dir="rtl">, the banner (role="note") in Arabic AND English; none under en/hi/gu; the picker offers Arabic as a
//      machine draft;
//   3. the pages — Arabic text with named en strings absent, every amount Indian-shaped + isolated, Western digits, no bare arrow;
//   4. under en/hi/gu the pages are BYTE-IDENTICAL to the same render with the RTL-1c helpers swapped back to the 3cb3bb8b calls.
import * as React from 'react';
import { formatMoneyMinor } from '@krishalaya/i18n';

// ---- the request: the only thing faked about language ------------------------------------------------------------------------------------
const mockReq: { cookies: Record<string, string>; headers: Record<string, string> } = { cookies: {}, headers: {} };
jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => ({
  cookies: () => ({ get: (n: string) => (n in mockReq.cookies ? { name: n, value: mockReq.cookies[n] } : undefined), has: (n: string) => n in mockReq.cookies }),
  headers: () => new Headers(mockReq.headers),
}));
jest.mock('next/navigation', () => ({ ...jest.requireActual('next/navigation'), usePathname: () => '/anand-fpo', useSearchParams: () => null,
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('../styles/globals.css', () => ({}), { virtual: true });

// ---- the session and the data (the existing STORE-2a / STORE-2b fixtures) ------------------------------------------------------------------
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/auth', () => ({ hasSessionCookie: () => true, getSessionTenant: () => jest.requireActual('./store2b-fixtures').T, getSessionToken: () => 'tok' }));
jest.mock('../features/cart/summary', () => ({ getCartItemCount: async () => 2 }));
jest.mock('../lib/storefront-data', () => ({
  loadTenantShell: (s: string) => jest.requireActual('./store2b-fixtures').shell(s),
  loadTenantProfile: async () => ({ ok: true, data: jest.requireActual('./store2a-fixtures').S.profile }),
}));
jest.mock('../lib/api-client', () => {
  const a = jest.requireActual('./store2a-fixtures'); const b = jest.requireActual('./store2b-fixtures');
  const pub = () => {
    const x = a.apiClient();
    return { ...x, storefront: { ...x.storefront, flags: async () => ({ ...a.S.flags, ...b.W.flags }) } };
  };
  return { publicClient: pub, serverClient: b.serverClient, sessionTenantClient: b.sessionTenantClient };
});
jest.mock('../app/[tenantSlug]/cart/actions', () => ({ updateCartLineAction: async () => undefined, removeCartLineAction: async () => undefined, acceptPriceAction: async () => undefined }));

import RootLayout from '../app/layout';
import TenantLayout from '../app/[tenantSlug]/layout';
import TenantStorefront from '../app/[tenantSlug]/page';
import ListingDetail from '../app/[tenantSlug]/listings/[id]/page';
import TenantCart from '../app/[tenantSlug]/cart/page';
import { TenantHeader } from '../components/TenantHeader';
import { getLang, getLanguageDef } from '../lib/i18n';
import * as moneyModule from '../features/rtl/money';
import * as spanModule from '../features/rtl/span';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { ar } from '../i18n/ar';
import { renderResolved } from './store1b-harness';
import { S, reset as resetA, L1 } from './store2a-fixtures';
import { W, reset as resetB, LINE, DRIFT, ID } from './store2b-fixtures';

// ---- helpers --------------------------------------------------------------------------------------------------------------------------------
type Who = { cookie?: string; accept?: string };
function as(who: Who) {
  mockReq.cookies = who.cookie ? { kv_lang: who.cookie } : {};
  mockReq.headers = who.accept ? { 'accept-language': who.accept } : {};
}
const SLUG = 'anand-fpo';
async function page(who: Who, mount: () => Promise<React.ReactNode>): Promise<string> {
  as(who);
  const children = await mount();
  const store = await TenantLayout({ children, params: { tenantSlug: SLUG } });
  return renderResolved(RootLayout({ children: store as React.ReactElement }), [TenantHeader]);
}
const home = () => TenantStorefront({ params: { tenantSlug: SLUG }, searchParams: {} });
const lot = () => ListingDetail({ params: { tenantSlug: SLUG, id: L1 }, searchParams: {} });
const cart = () => TenantCart({ params: { tenantSlug: SLUG }, searchParams: {} });
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const htmlTag = (html: string) => html.match(/<html[^>]*>/)?.[0] ?? '';
const main = (html: string) => html.match(/<main[^>]*>([\s\S]*)<\/main>/)?.[1] ?? '';
const BANNER = /<div class="kv-md-banner" role="note" data-kv-md-banner="ar"><p lang="ar" dir="rtl">/;
const ARABIC = /[؀-ۿ]/;
const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/;
const LRI = '⁦'; const PDI = '⁩';
/** Bare horizontal arrows: what is left after removing the flipping span and the ar catalogue's own (reversed) arrows. */
function bareArrows(html: string): number {
  let rest = html.replace(/<span class="kv-dir-flip">→<\/span>/g, '');
  for (const v of Object.values(ar).filter((x) => x.includes('←'))) rest = rest.split(esc(v)).join('');
  return (rest.match(/[→←]/g) ?? []).length;
}
/** Every money run in the page body (LRI…PDI) and how many "₹" are left OUTSIDE any isolate (must be 0 under ar). */
function amounts(html: string): { isolated: string[]; bare: number } {
  const body = main(html).replace(/<style[\s\S]*?<\/style>/g, '');
  const isolated = [...body.matchAll(/⁦([^⁦⁩]*)⁩/g)].map((m) => m[1]).filter((r) => r.includes('₹'));
  const rest = body.replace(/⁦[^⁦⁩]*⁩/g, '');
  return { isolated, bare: (rest.match(/₹/g) ?? []).length };
}
/** The Indian (en-IN) shape: optional sign, symbol first, lakh grouping, 2 decimals. */
const INDIAN = /^[-+−]?₹(?:\d{1,2},(?:\d{2},)*\d{3}|\d{1,3})\.\d{2}$/;

beforeEach(() => {
  resetA(); resetB();
  W.cart = { items: [LINE(ID.ok), DRIFT], subtotalMinor: '8198000', currencyCode: 'INR' };
  S.search = { ...S.search, items: [{ ...S.search.items[0], priceMinor: '12345650' }, S.search.items[1]] };
});

// ---- 1 · resolution ----------------------------------------------------------------------------------------------------------------------
describe('1 · the storefront serves Arabic only from an explicit choice (founder Q1 "opt-in only")', () => {
  it('the kv_lang cookie `ar` (set by the picker, the language route or ?lang=ar) → ar, rtl, Western-digit Intl tag', () => {
    as({ cookie: 'ar' });
    expect(getLang()).toBe('ar');
    expect(getLanguageDef()).toMatchObject({ code: 'ar', dir: 'rtl', intlLocale: 'ar-AE-u-nu-latn' });
  });
  it('an Accept-Language `ar` browser with no cookie gets ENGLISH — never Arabic from a browser preference', () => {
    for (const accept of ['ar', 'ar-AE', 'ar-AE,ar;q=0.9,en;q=0.8']) {
      as({ accept });
      expect(getLang()).toBe('en');
      expect(getLanguageDef().dir).toBe('ltr');
    }
  });
  it('en / hi / gu resolve exactly as before, from the cookie and from Accept-Language; a coming-soon code is still refused', () => {
    for (const code of ['en', 'hi', 'gu']) {
      as({ cookie: code }); expect(getLanguageDef()).toMatchObject({ code, dir: 'ltr' });
      as({ accept: code }); expect(getLanguageDef()).toMatchObject({ code, dir: 'ltr' });
    }
    as({}); expect(getLang()).toBe('en');
    as({ cookie: 'ur' }); expect(getLang()).toBe('en');
  });
});

// ---- 2 · the shell -----------------------------------------------------------------------------------------------------------------------
describe('2 · the shell under Arabic: <html dir>, the machine-draft banner, the picker', () => {
  it('<html lang="ar" dir="rtl"> comes from the resolution; the banner says it is a machine draft, in Arabic AND English', async () => {
    const html = await page({ cookie: 'ar' }, home);
    expect(htmlTag(html)).toMatch(/ lang="ar"/);
    expect(htmlTag(html)).toMatch(/ dir="rtl"/);
    expect(html).toMatch(BANNER);
    expect(html).toContain(`<p lang="ar" dir="rtl">${esc(ar['rtl.draftBanner'])}</p>`);
    expect(html).toContain('<p lang="en" dir="ltr">This Arabic text is a machine draft and has not been reviewed.</p>');
    expect(html.indexOf('kv-md-banner')).toBeLessThan(html.indexOf('data-kv-header="tenant"'));   // above the store's chrome
  });
  it('the chrome is Arabic: the skip link, the language label, the picker marks Arabic active', async () => {
    const html = await page({ cookie: 'ar' }, home);
    for (const k of ['common.skipToContent', 'lang.label']) expect(html).toContain(esc(ar[k]));
    expect(html).not.toContain(`>${esc(en['common.skipToContent'])}<`);
    expect(html).toMatch(/<button type="submit" name="lang" value="ar" aria-pressed="true" class="kv-locale__btn kv-locale__btn--draft is-active"><bdi lang="ar" dir="rtl">العربية<\/bdi> <span class="kv-locale__draft">\(مسودة آلية\)<\/span><\/button>/);
  });
  it('under en the picker offers Arabic as a real choice labelled "machine draft" — and no longer as "coming soon"', async () => {
    const html = await page({ cookie: 'en' }, home);
    expect(html).toMatch(/<button type="submit" name="lang" value="ar" aria-pressed="false" class="kv-locale__btn kv-locale__btn--draft"><bdi lang="ar" dir="rtl">العربية<\/bdi> <span class="kv-locale__draft">\(machine draft\)<\/span><\/button>/);
    expect(html).not.toMatch(/class="kv-locale__soon"[^>]*>العربية/);
    expect(html).toMatch(/class="kv-locale__soon"[^>]*>اردو/);   // the other coming-soon languages stay where they were
  });
  it('under en / hi / gu and an ar browser preference: dir="ltr" and NO banner', async () => {
    for (const who of [{ cookie: 'en' }, { cookie: 'hi' }, { cookie: 'gu' }, { accept: 'ar' }]) {
      const html = await page(who, home);
      expect(htmlTag(html)).toMatch(/ dir="ltr"/);
      expect(html).not.toContain('kv-md-banner');
      expect(ARABIC.test(main(html))).toBe(false);
    }
  });
});

// ---- 3 · the pages -----------------------------------------------------------------------------------------------------------------------
const PAGES: Array<[string, () => Promise<React.ReactNode>, string[], string[]]> = [
  ['/[tenantSlug] (the store catalogue — listing cards)', home, ['₹1,23,456.50', '₹6,150.00'], ['common.skipToContent']],
  ['/[tenantSlug]/listings/[id] (the product page)', lot, ['₹6,150.00'], ['lot.feesAtCheckout', 'lot.attributes.title', 'listing.sellerTitle']],
  ['/[tenantSlug]/cart (the cart summary)', cart, ['₹6,150.00', '₹61,500.00', '₹2,560.00', '₹2,520.00', '₹2,560.00', '+₹40.00', '₹2,560.00', '₹20,480.00', '₹81,980.00'], ['cart.itemsSubtotal', 'cart.drift.title', 'cart.drift.body']],
];

describe('3 · the store catalogue, a product page and the cart summary in Arabic inside the real chrome', () => {
  it.each(PAGES)('%s: dir="rtl", the banner, Arabic copy with the named en strings absent, Western digits, no bare arrow', async (_n, mount, _amounts, named) => {
    const html = await page({ cookie: 'ar' }, mount);
    expect(htmlTag(html)).toMatch(/ dir="rtl"/);
    expect(html).toMatch(BANNER);
    const body = main(html);
    expect(body.length).toBeGreaterThan(500);
    expect(ARABIC.test(body)).toBe(true);
    for (const k of named.filter((k) => !/\{/.test(en[k]))) {
      expect({ k, en: html.includes(esc(en[k])) }).toEqual({ k, en: false });
      expect({ k, ar: html.includes(esc(ar[k])) }).toEqual({ k, ar: true });
    }
    // no raw key id leaked (a key with no value anywhere renders as itself)
    expect(Object.keys(ar).filter((k) => html.includes(`>${k}<`) || html.includes(`"${k}"`))).toEqual([]);
    expect(ARABIC_INDIC_DIGIT.test(html)).toBe(false);
    expect(bareArrows(html)).toBe(0);
  });

  it.each(PAGES)('%s under ar: every amount is isolated (LRI…PDI), in the Indian shape, never "123,456.50 ₹"', async (_n, mount, expected) => {
    const html = await page({ cookie: 'ar' }, mount);
    const a = amounts(html);
    expect(a.isolated).toEqual(expected);
    expect(a.bare).toBe(0);
    expect(a.isolated.filter((x) => !INDIAN.test(x))).toEqual([]);
    expect(main(html)).not.toMatch(/\d\s*₹/);                       // never the ar locale's trailing symbol
    expect(main(html)).not.toMatch(/‏-?\d[\d,]*\.\d{2}/);       // nor its RLM-led amount
  });

  it('the cart under ar: the changed price keeps its flipping arrow and its signed delta INSIDE one isolate', async () => {
    const body = main(await page({ cookie: 'ar' }, cart));
    expect(body).toMatch(new RegExp(`data-kv-price="added">${LRI}₹2,520\\.00${PDI}</span> <span class="kv-dir-flip">→</span>`));
    expect(body).toContain(`data-kv-price="delta">${LRI}+₹40.00${PDI}</span>`);
    expect(body).toContain(esc(ar['cart.drift.accept'].replace('{price}', `${LRI}₹2,560.00${PDI}`)).split('{unit}')[0]);   // money inside an Arabic sentence
  });

  it.each(PAGES)('%s under en: the same amounts, en-IN, NO isolation marks, English copy', async (_n, mount, expected) => {
    const html = await page({ cookie: 'en' }, mount);
    const body = main(html);
    expect(body).not.toMatch(/[⁦-⁩]/);
    for (const x of expected) expect(body).toContain(x);
    expect(ARABIC.test(body)).toBe(false);
  });
});

// ---- 4 · en / hi / gu byte-identical ------------------------------------------------------------------------------------------------------
// The whole rendered page with the RTL-1c helpers as built, and the same render with them swapped back to the 3cb3bb8b calls: `moneyString` →
// the bare `formatMoneyMinor(…, lang)`, `ltrText` → the text itself. Under en/hi/gu the two are identical to the byte; under ar they differ (so the
// comparison can see a change). The banner and the picker's Arabic button are the wave's two DELIBERATE chrome changes (the banner never draws under
// en/hi/gu — section 2; the picker change is pinned in section 2), and both renders here include them equally.
async function nowAndBefore(cookie: string, mount: () => Promise<React.ReactNode>): Promise<[string, string]> {
  jest.useFakeTimers({ now: new Date('2026-10-04T10:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
  try {
    const now = await page({ cookie }, mount);
    const m = jest.spyOn(moneyModule, 'moneyString').mockImplementation((x, c, l) => formatMoneyMinor(x, c, l));
    const s = jest.spyOn(spanModule, 'ltrText').mockImplementation((x) => x);
    try { return [now, await page({ cookie }, mount)]; } finally { m.mockRestore(); s.mockRestore(); }
  } finally { jest.useRealTimers(); }
}
describe('4 · under en / hi / gu every page is BYTE-IDENTICAL to the bare 3cb3bb8b calls', () => {
  it.each(PAGES)('%s', async (_n, mount, expected) => {
    for (const cookie of ['en', 'hi', 'gu']) {
      const [now, before] = await nowAndBefore(cookie, mount);
      expect({ cookie, same: now === before }).toEqual({ cookie, same: true });
      expect(now).toContain(expected[0]);
    }
    const [arNow, arBefore] = await nowAndBefore('ar', mount);
    expect(arNow).not.toBe(arBefore);
    expect(arBefore).not.toContain(`${LRI}${expected[0]}${PDI}`);
  });
  it('hi is still Hindi (the h1 and the banner-free chrome)', async () => {
    const html = await page({ cookie: 'hi' }, cart);
    expect(html).toContain(esc(hi['cart.itemsSubtotal']));
    expect(html).not.toContain('kv-md-banner');
  });
});
