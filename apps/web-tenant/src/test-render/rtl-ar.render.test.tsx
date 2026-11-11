// apps/web-tenant/src/test-render/rtl-ar.render.test.tsx · PC-56 RTL-1b-1 · THE PROOF (survey §7).
//
// What every earlier rtl test did NOT do: render real ARABIC copy, with `dir` coming from the app's OWN language
// resolution — not a hand-placed <div dir="rtl">. Here only the request itself is faked (`next/headers`: the `kvt_lang`
// cookie and the Accept-Language header); the REAL `lib/i18n` resolves the language, the REAL root layout draws
// <html lang dir>, the machine-draft banner and the console chrome (AppShell, Sidebar + the language picker, Topbar +
// the bell), and the REAL /listings and /listings/import pages are mounted inside it. Data comes from SDK-typed fixtures.
//
// Asserted (founder Q1/Q2/Q4 + the lead's money shape, brief_rtl1b.md §D/§C):
//   1. resolution — cookie `ar` → Arabic, rtl; Accept-Language `ar` → ENGLISH (opt-in only); en/hi/gu unchanged;
//   2. layout — <html lang="ar" dir="rtl">, the banner (role="note") in Arabic AND English; no banner under en/hi/gu;
//   3. the pages — Arabic text (the h1 is the ar value, no raw key ids), every amount in <bdi dir="ltr"> in the Indian
//      shape with Western digits only, the file name and hash isolated, no bare arrow, every aria-label filled and Arabic.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BulkImportJob, ConsoleCounts, ConsoleListingRow, ListingCard, NotificationBell } from '@krishalaya/sdk-js';
import { en } from '../i18n/en';
import { ar } from '../i18n/ar';
import { hi } from '../i18n/hi';

// ---- the request: the only thing faked about language ------------------------------------------------------------------
const mockReq: { cookies: Record<string, string>; headers: Record<string, string> } = { cookies: {}, headers: {} };
jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => ({
  cookies: () => ({ get: (n: string) => (n in mockReq.cookies ? { name: n, value: mockReq.cookies[n] } : undefined) }),
  headers: () => ({ get: (n: string) => mockReq.headers[n.toLowerCase()] ?? null }),
}));
jest.mock('next/navigation', () => ({ usePathname: () => '/listings', useSearchParams: () => null }));
jest.mock('../styles/globals.css', () => ({}));

// ---- the session, permissions and data --------------------------------------------------------------------------------
const mockPerm = { staff: true };
jest.mock('../lib/session', () => ({ requireSession: async () => ({}) }));
jest.mock('../lib/auth', () => ({ tenantHasPerm: () => mockPerm.staff, hasSessionCookie: () => true }));
jest.mock('../lib/env', () => ({ env: { appName: 'Krishalaya' } }));
jest.mock('../app/listings/actions', () => ({ bulkListingsAction: async () => undefined }));
jest.mock('../app/listings/import/actions', () => ({ validateListingJobAction: async () => undefined, confirmListingJobAction: async () => undefined, cancelListingJobAction: async () => undefined }));

const U = (n: number) => `0190a8b2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const AT = '2026-10-04T09:48:00.000Z';
const rows: ConsoleListingRow[] = [
  { id: U(1), title: 'Nashik tomato, grade A', status: 'published', sellerUserId: U(2), sellerName: 'Asha Patel', productName: 'Tomato', priceMinor: '12345650', currencyCode: 'INR',
    unitCode: 'qtl', quantityAvailable: '40', quantityTotal: '50', saleType: 'direct', publishedAt: AT, createdAt: AT, qcSubmittedAt: null },
  { id: U(3), title: 'Groundnut GG-20', status: 'pending_approval', sellerUserId: U(4), sellerName: null, productName: null, priceMinor: '845000', currencyCode: 'INR',
    unitCode: 'kg', quantityAvailable: '1200', quantityTotal: '1200', saleType: 'auction', publishedAt: null, createdAt: AT, qcSubmittedAt: AT },
];
const counts = { all: 2, published: 1, pending_approval: 1 } as ConsoleCounts;
const cards: ListingCard[] = [
  { id: U(5), title: 'Wheat, Lok-1', priceMinor: '260000', currencyCode: 'INR', unitCode: 'qtl', quantityAvailable: 30, organicClaim: true, saleType: 'direct', regionId: null, sellerUserId: U(2), boosted: false },
];
const SHA = 'a3f9c2d41b7e0f5566778899aabbccddeeff00112233445566778899aabbccdd';
const jobs: BulkImportJob[] = [{
  id: U(6), importType: 'listings', storageKey: 'k', originalFilename: 'FPO-Nashik_lots-2026-10.csv', status: 'validated', totalRows: 12, processedRows: 0, succeededRows: 0,
  failedRows: 0, errorSummary: null, fileSha256: SHA, validatedAt: AT, createdAt: AT,
  validation: { totalRows: 12, willCreate: 9, alreadyMembers: 1, fixable: 1, invalid: 1, issuesTruncated: false,
    issues: [{ rowIndex: 4, code: 'PRICE_UNIT', message: 'price looks per-kilo on a per-quintal sheet', suggestion: '₹2,450 / qtl' }] },
}];
const bell: NotificationBell = { unread: 3, latest: [], held: 0, nextRelease: null, releaseStopped: false, zone: 'Asia/Kolkata', today: '2026-10-04' };
const mockClient = {
  auth: { me: async () => ({ id: U(2), displayName: 'Asha Patel' }) },
  notifications: { bell: async () => bell },
  listings: { consoleCounts: async () => counts, consoleList: async () => ({ items: rows, nextCursor: 'c1' }), browse: async () => ({ items: cards, nextCursor: null }) },
  bulkImports: { list: async () => ({ items: jobs, nextCursor: null }) },
};
jest.mock('../lib/api-client', () => ({ tenantClient: () => mockClient }));

import RootLayout from '../app/layout';
import ListingsPage from '../app/listings/page';
import ListingImportPage from '../app/listings/import/page';
import { getLang, getLanguageDef } from '../lib/i18n';
import { rich } from '../components/Bidi';

// ---- helpers ------------------------------------------------------------------------------------------------------------
type Who = { cookie?: string; accept?: string };
function as(who: Who) {
  mockReq.cookies = who.cookie ? { kvt_lang: who.cookie } : {};
  mockReq.headers = who.accept ? { 'accept-language': who.accept } : {};
}
async function page(who: Who, mount: () => Promise<React.ReactNode>): Promise<string> {
  as(who);
  const children = await mount();
  return renderToStaticMarkup(await RootLayout({ children: children as React.ReactElement }));
}
const listings = () => ListingsPage({ searchParams: {} });
const importPage = () => ListingImportPage({ searchParams: {} });
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const htmlTag = (html: string) => html.match(/^<html[^>]*>/)?.[0] ?? '';
const h1 = (html: string) => html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '';
const BANNER = /<div class="kv-md-banner" role="note" data-kv-md-banner="ar">/;

/** Bare horizontal arrows: what is left after removing the flipping span and the ar catalogue's own (reversed) arrows. */
function bareArrows(html: string): number {
  let rest = html.replace(/<span class="kv-dir-flip">→<\/span>/g, '');
  for (const v of Object.values(ar).filter((x) => x.includes('←'))) rest = rest.split(esc(v)).join('');
  return (rest.match(/[→←]/g) ?? []).length;
}
/** Every rupee amount in the page, and how many of them sit inside an LTR <bdi>. */
function money(html: string): { all: number; isolated: string[] } {
  // rendered text only: the design tokens in <style> carry `--currency-symbol: "₹"`, which is not an amount
  const all = (html.replace(/<style[\s\S]*?<\/style>/g, '').match(/₹/g) ?? []).length;
  const isolated = [...html.matchAll(/<bdi dir="ltr" class="kv-money">(₹[^<]*)<\/bdi>/g)].map((m) => m[1]);
  return { all, isolated };
}
const ARABIC = /[؀-ۿ]/;
const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/;

// ---- 1 · resolution ------------------------------------------------------------------------------------------------------
describe('1 · the console resolves Arabic only from an explicit choice (founder Q1 "opt-in only")', () => {
  it('the kvt_lang cookie `ar` (set by the picker or ?lang=ar) → ar, rtl', () => {
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
  it('en / hi / gu resolve exactly as before, from the cookie and from Accept-Language', () => {
    for (const code of ['en', 'hi', 'gu']) {
      as({ cookie: code }); expect(getLanguageDef()).toMatchObject({ code, dir: 'ltr' });
      as({ accept: code }); expect(getLanguageDef()).toMatchObject({ code, dir: 'ltr' });
    }
    as({}); expect(getLang()).toBe('en');
    as({ cookie: 'bn' }); expect(getLang()).toBe('en'); // a coming-soon code is still refused
  });
});

// ---- 2 · the shell -------------------------------------------------------------------------------------------------------
describe('2 · the shell under Arabic: <html dir>, the machine-draft banner, the picker', () => {
  it('<html lang="ar" dir="rtl"> comes from the resolution; the banner says it is a machine draft, in Arabic AND English', async () => {
    const html = await page({ cookie: 'ar' }, listings);
    expect(htmlTag(html)).toMatch(/ lang="ar"/);
    expect(htmlTag(html)).toMatch(/ dir="rtl"/);
    expect(html).toMatch(BANNER);
    expect(html).toContain(`<p lang="ar" dir="rtl">${esc(ar['rtl.draftBanner'])}</p>`);
    expect(html).toContain('<p lang="en" dir="ltr">This Arabic text is a machine draft and has not been reviewed.</p>');
  });
  it('the chrome is Arabic: the nav, the skip link, the language label, the bell', async () => {
    const html = await page({ cookie: 'ar' }, listings);
    for (const k of ['nav.dashboard', 'nav.listings', 'nav.primary', 'nav.signOut', 'common.skipToContent', 'lang.label']) expect(html).toContain(esc(ar[k]));
    expect(html).toContain(`aria-label="${esc(ar['notif.bell.labelUnread'].replace('{n}', '3'))}"`);
    expect(html).not.toContain(esc(en['nav.signOut']));
  });
  it('the picker offers Arabic as a real choice, labelled as a machine draft (and no longer as "coming soon")', async () => {
    const html = await page({ cookie: 'en' }, listings);
    expect(html).toMatch(/<button type="submit" name="lang" value="ar" aria-pressed="false" class="kv-locale__btn kv-locale__btn--draft"><bdi lang="ar" dir="rtl">العربية<\/bdi> <span class="kv-locale__draft">\(machine draft\)<\/span><\/button>/);
    expect(html).not.toMatch(/class="kv-locale__soon"[^>]*>العربية/);
    expect(html).toContain('aria-label="Coming soon"');
  });
  it('under en / hi / gu: dir="ltr", NO banner, and an ar browser preference changes nothing', async () => {
    for (const who of [{ cookie: 'en' }, { cookie: 'hi' }, { cookie: 'gu' }, { accept: 'ar' }]) {
      const html = await page(who, listings);
      expect(htmlTag(html)).toMatch(/ dir="ltr"/);
      expect(html).not.toContain('kv-md-banner');
    }
    expect(h1(await page({ cookie: 'hi' }, listings))).toBe(esc(hi['listings.title']));
    expect(h1(await page({ accept: 'ar' }, listings))).toBe(esc(en['listings.title']));
  });
});

// ---- 3 · the proof pages -------------------------------------------------------------------------------------------------
describe('3 · /listings and /listings/import in Arabic inside the real chrome', () => {
  const cases: Array<[string, () => Promise<React.ReactNode>, boolean, string]> = [
    ['/listings (staff console — the dense money table)', listings, true, 'listings.title'],
    ['/listings (owner view — @krishalaya/ui DataTable)', listings, false, 'listings.title'],
    ['/listings/import (the canon route, W128)', importPage, true, 'limport.title'],
  ];
  it.each(cases)('%s: Arabic text, Western digits, no bare arrow, every aria-label Arabic', async (_n, mount, staff, titleKey) => {
    mockPerm.staff = staff;
    const html = await page({ cookie: 'ar' }, mount);
    expect(htmlTag(html)).toMatch(/ dir="rtl"/);
    expect(html).toMatch(BANNER);
    expect(h1(html)).toBe(esc(ar[titleKey]));
    expect(h1(html)).not.toBe(esc(en[titleKey]));
    expect(ARABIC.test(h1(html))).toBe(true);
    // no raw key id leaked into the page (a key with no value anywhere renders as itself)
    expect(Object.keys(ar).filter((k) => html.includes(`>${k}<`) || html.includes(`"${k}"`))).toEqual([]);
    expect(ARABIC_INDIC_DIGIT.test(html)).toBe(false);
    expect(bareArrows(html)).toBe(0);
    const labels = [...html.matchAll(/ aria-label="([^"]*)"/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(2);
    expect(labels.filter((l) => l.trim() === '' || !ARABIC.test(l))).toEqual([]);
    mockPerm.staff = true;
  });

  it('/listings staff table: every amount is in <bdi dir="ltr">, Indian shape, symbol first (₹1,23,456.50)', async () => {
    const html = await page({ cookie: 'ar' }, listings);
    const m = money(html);
    expect(m.isolated).toEqual(['₹1,23,456.50', '₹8,450.00']);
    expect(m.all).toBe(m.isolated.length);
    expect(html).toContain('<td><bdi dir="ltr" class="kv-money">₹1,23,456.50</bdi> / qtl</td>');
    expect(html).not.toMatch(/123,456\.50\s*₹/); // never the ar locale's own "123,456.50 ₹"
  });

  it('/listings owner table (UI DataTable money cell): the amount is isolated too', async () => {
    mockPerm.staff = false;
    const html = await page({ cookie: 'ar' }, listings);
    mockPerm.staff = true;
    const m = money(html);
    expect(m.isolated).toEqual(['₹2,600.00']);
    expect(m.all).toBe(1);
  });

  it('/listings/import: the file name, the hash and the column codes are LTR isolates, never translated; the server\'s words are isolated', async () => {
    const html = await page({ cookie: 'ar' }, importPage);
    expect(html).toContain('<bdi dir="ltr">FPO-Nashik_lots-2026-10.csv</bdi>');
    expect(html).toContain(`${esc(ar['limport.hash'].replace(' {hash}', ''))} <bdi dir="ltr">${SHA.slice(0, 12)}</bdi>`);
    expect(html).toMatch(/<bdi dir="ltr">phone, product,[^<]*<\/bdi>/);
    expect(html).toContain('<bdi>price looks per-kilo on a per-quintal sheet</bdi>');
    expect(html).toContain('<bdi>₹2,450 / qtl</bdi>'); // a server suggestion is not ours to reformat — isolated as written
    expect(html).toContain(esc(ar['limport.trustPath']));
  });

  it('under English the same isolates are harmless: same text, same amounts', async () => {
    const html = await page({ cookie: 'en' }, listings);
    expect(money(html).isolated).toEqual(['₹1,23,456.50', '₹8,450.00']);
    expect(h1(html)).toBe(esc(en['listings.title']));
  });
});

describe('the rich() interpolation the isolates use', () => {
  it('substitutes nodes for tokens, keeps unknown tokens literal, keeps text order', () => {
    expect(renderToStaticMarkup(<p>{rich('file {hash} · {x}', { hash: <bdi dir="ltr">abc</bdi> })}</p>)).toBe('<p>file <bdi dir="ltr">abc</bdi> · {x}</p>');
  });
});
