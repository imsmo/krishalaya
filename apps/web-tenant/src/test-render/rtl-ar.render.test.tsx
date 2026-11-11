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
import type { BulkImportJob, ConsoleCounts, ConsoleListingRow, InvoiceMonthKpis, ListingCard, NotificationBell, RosterCensus, RosterMember, TenantDashboard, TradeInvoiceRow } from '@krishalaya/sdk-js';
import { formatMoneyMinor } from '@krishalaya/i18n';
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
jest.mock('../app/people/actions', () => ({ revealFieldAction: async () => undefined })); // RTL-1b-2: /people's reveal control
jest.mock('../app/invoices/actions', () => ({ exportGstr1Action: async () => undefined })); // RTL-1b-3: /invoices' GSTR-1 form

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
// RTL-1b-2 · /dashboard and /people fixtures. The counts are chosen ≥ 100,000 where it matters, so the digit SHAPE is visible:
// Arabic (ar-AE-u-nu-latn) groups "128,456"; English (en-IN, the console's en locale) "1,28,456".
const dash: TenantDashboard = {
  tiles: { gmvThisMonthMinor: '481260000', gmvPrevMonthSameDayMinor: '408000000', gmvChangeBp: 1795, payoutsPendingMinor: '34218000', payoutsPendingFarmers: 42,
    liveListings: 218, listingsNewToday: 12, listingsInQc: 3, openDisputes: 2, oldestDisputeHours: 9.4, currencyCode: 'INR', currencyMixed: false,
    ordersToday: 128456, kycPending: 7, walletMainMinor: null },
  needsYouToday: [{ kind: 'dispute', count: 2, oldestHours: 9.4, amountMinor: null, href: '/disputes' }],
  planHealth: { planCode: null, planName: null, status: null, membersUsed: 1284, memberLimit: 2000, currentPeriodEnd: AT },
};
const census: RosterCensus = { activeMembers: 128456, fullyVerified: 1000, activeLast30d: 900, dormant: 77, voiceFirstShare: null };
const roster: RosterMember[] = [{ userId: U(7), fullName: 'Asha Patel', phoneMasked: '+91 96••• ••114', villageName: 'Pimpalgaon', languageCode: 'mr',
  roles: [{ roleCode: 'farmer', kycStatus: 'verified', isActive: true }], lastActiveAt: AT, lifetimeReceivedMinor: '1234500' }];
// RTL-1b-3 · /invoices: the money-heavy page. KPIs in crores and lakhs, a partly credited invoice (its remainder is money
// INSIDE a t.t() sentence, inv.remaining), a zero-tax row (₹0.00 is a real amount there) and a NULL-tax row (never ₹0).
const invKpis: InvoiceMonthKpis = { count: 3, taxableMinor: '1234565000', taxMinor: '22222050', exemptMinor: '0', withoutBreakdown: 1, incompleteBasis: 0,
  windowFromIso: '2026-10-01T00:00:00.000Z', windowToIso: '2026-11-01T00:00:00.000Z' };
const invRows: TradeInvoiceRow[] = [
  { id: U(8), invoiceNo: 'INV-2026-000417', orderId: U(9), orderNo: 'ORD-88417', buyerGstin: '24AAAAA0000A1Z5', totalMinor: '12345650', taxMinor: '588000',
    taxableMinor: '11757650', exemptMinor: '0', supplyType: 'intra', placeOfSupplyCode: '24', taxBasisComplete: true, issuedAt: AT, createdAt: AT, creditedMinor: '345650' },
  { id: U(10), invoiceNo: 'INV-2026-000418', orderId: U(11), orderNo: 'ORD-88418', buyerGstin: null, totalMinor: '845000', taxMinor: '0',
    taxableMinor: '0', exemptMinor: '845000', supplyType: 'inter', placeOfSupplyCode: '27', taxBasisComplete: true, issuedAt: AT, createdAt: AT, creditedMinor: '0' },
  { id: U(12), invoiceNo: 'INV-2025-009001', orderId: U(13), orderNo: null, buyerGstin: null, totalMinor: '99', taxMinor: null,
    taxableMinor: null, exemptMinor: null, supplyType: null, placeOfSupplyCode: null, taxBasisComplete: null, issuedAt: null, createdAt: AT, creditedMinor: '0' },
];
const mockClient = {
  auth: { me: async () => ({ id: U(2), displayName: 'Asha Patel' }) },
  notifications: { bell: async () => bell },
  listings: { consoleCounts: async () => counts, consoleList: async () => ({ items: rows, nextCursor: 'c1' }), browse: async () => ({ items: cards, nextCursor: null }) },
  bulkImports: { list: async () => ({ items: jobs, nextCursor: null }) },
  consoleHome: { dashboard: async () => dash, goLive: async () => null },
  members: { roster: async () => ({ items: roster, census, nextCursor: null }) },
  payments: { invoices: { list: async () => ({ items: invRows, kpis: invKpis, nextCursor: null }) } },
};
jest.mock('../lib/api-client', () => ({ tenantClient: () => mockClient }));

import RootLayout from '../app/layout';
import ListingsPage from '../app/listings/page';
import ListingImportPage from '../app/listings/import/page';
import DashboardPage from '../app/dashboard/page';
import PeoplePage from '../app/people/page';
import InvoicesPage from '../app/invoices/page';
import * as moneyModule from '../features/rtl/money';
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

// ---- 4 · RTL-1b-2: the whole catalogue — /dashboard and /people in Arabic ------------------------------------------------
// Two pages outside RTL-1b-1's scope, rendered in the real chrome: before 1b-2 every string on them fell back to English.
// "Every visible string is Arabic" is checked two ways: (a) a named handful of en strings must be ABSENT, and (b) EVERY en
// value of the page's own namespaces that differs from its ar value must be absent from the markup (a whole-namespace
// fallback to English, or one key left behind, turns this red). Counts must be Western digits in the ar locale's grouping.
describe('4 · /dashboard and /people in Arabic (RTL-1b-2: the whole catalogue)', () => {
  const dashboard = () => DashboardPage();
  const people = () => PeoplePage({ searchParams: {} });
  /** The page body only (inside <main>), so the chrome's own checks (section 2) are not re-counted here. */
  const main = (html: string) => html.match(/<main[^>]*>([\s\S]*)<\/main>/)?.[1] ?? '';
  /** The VISIBLE text (tags and their attributes removed — a `?kyc=verified` href is not copy), one node per line. */
  const visible = (html: string) => html.replace(/<[^>]*>/g, '\n');
  /** Every en value of these namespaces that differs from ar and is long enough to be a word, found in the visible text. */
  const enLeaks = (html: string, prefixes: string[]) => Object.keys(en)
    .filter((k) => prefixes.some((p) => k.startsWith(p)) && en[k] !== ar[k] && en[k].length >= 6 && !/\{/.test(en[k]))
    .filter((k) => visible(html).includes(esc(en[k])));
  const PAGES: Array<[string, () => Promise<React.ReactNode>, string, string[], string[]]> = [
    ['/dashboard', dashboard, 'dashboard.title', ['dashboard.', 'home.', 'swd.home.'],
      ['home.tile.gmv', 'home.tile.payoutsNoSchedule', 'home.needsYou', 'home.planHealth', 'home.absentPanels', 'swd.home.tile.ordersToday', 'swd.home.newListing']],
    ['/people', people, 'people.title', ['people.'],
      ['people.subtitle', 'people.tile.active', 'people.tile.voiceAbsent', 'people.colMember', 'people.pagerNote', 'people.searchGo', 'people.tableCaption']],
  ];

  it.each(PAGES)('%s under ?lang=ar: dir="rtl", the banner, the h1 and the page copy in Arabic, no en string leaking', async (_n, mount, titleKey, prefixes, named) => {
    const html = await page({ cookie: 'ar' }, mount);
    expect(htmlTag(html)).toMatch(/ lang="ar"/);
    expect(htmlTag(html)).toMatch(/ dir="rtl"/);
    expect(html).toMatch(BANNER);
    expect(h1(html)).toBe(esc(ar[titleKey]));
    expect(ARABIC.test(h1(html))).toBe(true);
    const body = main(html);
    expect(body.length).toBeGreaterThan(1000);
    for (const k of named) {
      expect({ k, en: body.includes(esc(en[k])) }).toEqual({ k, en: false });
      expect({ k, ar: body.includes(esc(ar[k])) }).toEqual({ k, ar: true });
    }
    expect(enLeaks(body, prefixes)).toEqual([]);
    // and no visible English at all: once the fixture's own data (a name, a village) and the never-translated codes are
    // removed, no Latin word is left in the page body
    const NOT_COPY = /Asha Patel|Pimpalgaon|\bKYC\b|\bAadhaar\b|\bIST\b/g;
    const latin = visible(body.replace(/<style[\s\S]*?<\/style>/g, '')).split('\n').map((x) => x.trim())
      .filter((x) => /[A-Za-z]{2,}/.test(x.replace(NOT_COPY, '')));
    expect(latin).toEqual([]);
    // no raw key id leaked (a key with no value anywhere renders as itself)
    expect(Object.keys(ar).filter((k) => body.includes(`>${k}<`) || body.includes(`"${k}"`))).toEqual([]);
    expect(ARABIC_INDIC_DIGIT.test(html)).toBe(false);
    expect(bareArrows(html)).toBe(0);
    const labels = [...html.matchAll(/ aria-label="([^"]*)"/g)].map((m) => m[1]);
    expect(labels.filter((l) => l.trim() === '' || !ARABIC.test(l))).toEqual([]);
  });

  it('/dashboard counts under ar: Western digits, the ar grouping, through formatNumber (128,456 — never ١٢٨٬٤٥٦)', async () => {
    const html = main(await page({ cookie: 'ar' }, dashboard));
    for (const n of ['218', '2', '128,456', '7']) expect(html).toContain(`<strong>${n}</strong>`);
  });

  it('/people census under ar: Western digits, the ar grouping (128,456 · 1,000 · 900 · 77)', async () => {
    const html = main(await page({ cookie: 'ar' }, people));
    for (const n of ['128,456', '1,000', '900', '77']) expect(html).toContain(`<strong>${n}</strong>`);
    expect(html).toContain('<span class="kv-muted">+91 96••• ••114</span>'); // the masked phone is data, untouched
  });

  it('the same pages under en are unchanged English: dir="ltr", no banner, en copy, en-IN counts', async () => {
    for (const [, mount, titleKey, , named] of PAGES) {
      const html = await page({ cookie: 'en' }, mount);
      expect(htmlTag(html)).toMatch(/ dir="ltr"/);
      expect(html).not.toContain('kv-md-banner');
      expect(h1(html)).toBe(esc(en[titleKey]));
      for (const k of named) expect({ k, en: main(html).includes(esc(en[k])) }).toEqual({ k, en: true });
      expect(ARABIC.test(main(html))).toBe(false);
    }
    expect(main(await page({ cookie: 'en' }, dashboard))).toContain('<strong>1,28,456</strong>');
    expect(main(await page({ cookie: 'en' }, people))).toContain('<strong>1,28,456</strong>');
  });
});

// ---- 5 · RTL-1b-3: every amount app-wide — the Indian shape, isolated ----------------------------------------------------
// Before 1b-3 every page but /listings printed the Arabic locale's own money shape (an RLM, then "4,812,600.00 ₹"),
// unisolated. Now every amount goes through `moneyText` (LRI…PDI in text) or `<Money>` (<bdi dir="ltr">). Checked here:
// EVERY "₹" in the rendered page body sits inside one of the two isolates, and every isolated amount is the Indian shape
// with Western digits. Under en/hi/gu the page is BYTE-IDENTICAL to what it rendered before: the same render with
// `moneyText` swapped back to a bare `formatMoneyMinor(…, lang)` (the 2f55aa37 call) gives the same markup.
describe('5 · every amount in the Indian shape, isolated (RTL-1b-3: /dashboard, /people, /invoices)', () => {
  const main = (html: string) => html.match(/<main[^>]*>([\s\S]*)<\/main>/)?.[1] ?? '';
  const LRI = '\u2066'; const PDI = '\u2069';
  /** Every money run in the page body: the isolated ones (LRI…PDI or <bdi dir="ltr" class="kv-money">), and how many "₹"
   *  are left over OUTSIDE any isolate (must be 0). */
  function amounts(html: string): { isolated: string[]; bare: number } {
    const body = main(html).replace(/<style[\s\S]*?<\/style>/g, '');
    const runs: Array<[number, string]> = [];
    for (const m of body.matchAll(/\u2066([^\u2066\u2069]*)\u2069/g)) runs.push([m.index ?? 0, m[1]]);
    for (const m of body.matchAll(/<bdi dir="ltr" class="kv-money">([^<]*)<\/bdi>/g)) runs.push([m.index ?? 0, m[1]]);
    const rest = body.replace(/\u2066[^\u2066\u2069]*\u2069/g, '').replace(/<bdi dir="ltr" class="kv-money">[^<]*<\/bdi>/g, '');
    return { isolated: runs.sort((a, b) => a[0] - b[0]).map((r) => r[1]).filter((r) => r.includes('₹')), bare: (rest.match(/₹/g) ?? []).length };
  }
  /** The Indian (en-IN) shape: optional sign, symbol first, lakh grouping (last group of 3, then groups of 2), 2 decimals. */
  const INDIAN = /^-?₹(?:\d{1,2},(?:\d{2},)*\d{3}|\d{1,3})\.\d{2}$/;
  const dashboard = () => DashboardPage();
  const people = () => PeoplePage({ searchParams: {} });
  const invoices = () => InvoicesPage({ searchParams: {} });
  const PAGES: Array<[string, () => Promise<React.ReactNode>, string[]]> = [
    ['/dashboard', dashboard, ['₹48,12,600.00', '₹3,42,180.00']],
    ['/people', people, ['₹12,345.00']],
    ['/invoices', invoices, ['₹1,23,45,650.00', '₹2,22,220.50', '₹1,23,456.50', '₹1,20,000.00', '₹5,880.00', '₹8,450.00', '₹0.00', '₹0.99']],
  ];

  it.each(PAGES)('%s under ar: every amount is isolated, in the Indian shape, Western digits (never "4,812,600.00 ₹")', async (_n, mount, expected) => {
    const html = await page({ cookie: 'ar' }, mount);
    expect(htmlTag(html)).toMatch(/ dir="rtl"/);
    const a = amounts(html);
    expect(a.isolated).toEqual(expected);
    expect(a.bare).toBe(0);
    expect(a.isolated.filter((x) => !INDIAN.test(x))).toEqual([]);
    expect(main(html)).not.toMatch(/\d\s*₹/); // never the ar locale's trailing symbol
    expect(main(html)).not.toMatch(/\u200f-?\d[\d,]*\.\d{2}/); // nor its RLM-led amount (an ar DATE keeps its own RLMs)
    expect(ARABIC_INDIC_DIGIT.test(html)).toBe(false);
  });

  it('/invoices under ar: the money INSIDE a sentence (inv.remaining) carries its isolate, in the Arabic sentence', async () => {
    const body = main(await page({ cookie: 'ar' }, invoices));
    expect(body).toContain(esc(ar['inv.remaining'].replace('{amount}', `${LRI}₹1,20,000.00${PDI}`)));
    expect(body).toContain(`<span class="kv-kpi__value">${LRI}₹1,23,45,650.00${PDI}</span>`);
    expect(body).toContain(`<span>${LRI}₹0.00${PDI}</span>`); // a recorded zero tax is a real amount, isolated like any other
    expect(body).toContain(esc(ar['inv.taxNotRecorded'])); // and a NULL tax is still words, never ₹0
  });

  it('/dashboard under ar: the tiles carry the isolate inside <strong>', async () => {
    const body = main(await page({ cookie: 'ar' }, dashboard));
    expect(body).toContain(`<strong>${LRI}₹48,12,600.00${PDI}</strong>`);
    expect(body).toContain(`<strong>${LRI}₹3,42,180.00${PDI}</strong>`);
  });

  it.each(PAGES)('%s under en: the same amounts, en-IN, NO isolation marks', async (_n, mount, expected) => {
    const html = await page({ cookie: 'en' }, mount);
    const body = main(html);
    expect(body).not.toMatch(/[\u2066-\u2069]/);
    expect(amounts(html)).toEqual({ isolated: [], bare: expected.length });
    for (const x of expected) expect(body).toContain(x);
  });

  /** The whole rendered page, with moneyText as built and with moneyText swapped back to the bare 2f55aa37 call. The
   *  clock is pinned (the /dashboard "as of" line prints the render time) so the two renders compare byte for byte. */
  async function nowAndBefore(cookie: string, mount: () => Promise<React.ReactNode>): Promise<[string, string]> {
    jest.useFakeTimers({ now: new Date('2026-10-04T10:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
    try {
      const now = await page({ cookie }, mount);
      const spy = jest.spyOn(moneyModule, 'moneyText').mockImplementation((m, c, l) => formatMoneyMinor(m, c, l));
      try { return [now, await page({ cookie }, mount)]; } finally { spy.mockRestore(); }
    } finally { jest.useRealTimers(); }
  }
  it.each(PAGES)('%s under en / hi / gu is BYTE-IDENTICAL to the bare formatMoneyMinor render (2f55aa37)', async (_n, mount, expected) => {
    for (const cookie of ['en', 'hi', 'gu']) {
      const [now, before] = await nowAndBefore(cookie, mount);
      expect({ cookie, same: now === before }).toEqual({ cookie, same: true });
      expect(now).toContain(expected[0]);
    }
    // and the comparison can see a difference: under ar the bare call renders a different page, in the ar locale's shape
    const [arNow, arBefore] = await nowAndBefore('ar', mount);
    expect(arNow).not.toBe(arBefore);
    expect(arBefore).not.toContain(expected[0]);
  });
});
