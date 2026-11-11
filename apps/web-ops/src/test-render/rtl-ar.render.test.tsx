// apps/web-ops/src/test-render/rtl-ar.render.test.tsx · PC-56 RTL-1e · THE PROOF for the ops console (web-tenant's RTL-1b / web-partner's RTL-1d
// rtl-ar.render, adapted).
//
// What every earlier ops rtl test (rtl-ops1a … rtl-ops5b) did NOT do: render real ARABIC copy, with `dir` coming from the app's OWN language
// resolution — not a hand-placed dir="rtl", and not a hand-built translator. Here only the request is faked (`next/headers`: the `kvo_lang`
// cookie, the session cookie, the Accept-Language header) and the API answers with the existing render fixtures; the REAL `lib/i18n` resolves
// the language, the REAL root layout draws <html lang dir>, the machine-draft banner and the REAL Sidebar (with the REAL LocaleSwitcher), and
// the REAL pages are mounted inside: the ops home (`/dashboard`), the money-heavy payout run (`/payout` — gross, deductions and net per bill,
// member codes) and the AePS exceptions list (`/aeps/exceptions` — event ids, kinds, times, amounts).
//
// Asserted (founder Q1/Q2/Q4 + the lead's money shape, brief_rtl1e.md §D):
//   1. resolution — cookie `ar` → Arabic, rtl; Accept-Language `ar` → ENGLISH (opt-in only); en/hi/gu unchanged;
//   2. the shell — <html lang="ar" dir="rtl">, the banner (role="note") in Arabic AND English, above the shell; none under en/hi/gu;
//      the switcher offers Arabic as a labelled machine draft;
//   3. the pages — Arabic text with named en strings absent, every amount Indian-shaped + isolated, Western digits, no bare arrow;
//   4. under en/hi/gu the pages are BYTE-IDENTICAL to the same render with the RTL-1e helpers swapped back to the 94d07840 calls;
//   5. codes inside Arabic sentences are isolated; the error boundary reads the cookie the same way (ar explicit, nothing else invented).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatMoneyMinor } from '@krishalaya/i18n';

// ---- the request: the only thing faked about language --------------------------------------------------------------------------------------
const mockReq: { cookies: Record<string, string>; headers: Record<string, string> } = { cookies: {}, headers: {} };
jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => ({
  cookies: () => ({ get: (n: string) => (n in mockReq.cookies ? { name: n, value: mockReq.cookies[n] } : undefined), has: (n: string) => n in mockReq.cookies, set: () => undefined, delete: () => undefined }),
  headers: () => new Headers(mockReq.headers),
}));
jest.mock('next/navigation', () => ({ ...jest.requireActual('next/navigation'),
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('../styles/globals.css', () => ({}), { virtual: true });

// ---- the session and the data (the existing OPS-1a / OPS-1b fixtures, plus one bill past 2^53) ----------------------------------------------
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', tenantId: 't-1' } }));
jest.mock('../lib/api-client', () => {
  const a = jest.requireActual('./ops1a-fixtures'); const b = jest.requireActual('./ops1b-fixtures');
  const big = { ...a.BILLS_1A[0], id: '0192d2c4-b001-7000-8000-000000000004', membershipId: 'm-0001', grossMinor: '9007199254740993', deductionsMinor: '0', netMinor: '9007199254740993' };
  const client = {
    auth: { me: async () => ({ id: 'u-1', displayName: 'Ops Tester' }), refresh: async () => { throw new Error('no refresh'); } },
    dairy: {
      listBills: async () => ({ items: [...a.BILLS_1A, big], nextCursor: null }),
      listBillCycles: async () => [],
      listMemberships: async () => ({ items: [{ id: 'm-0001', memberCode: 'TC-01' }, { id: 'm-0002', memberCode: 'TC-02' }], nextCursor: null }),
    },
    ambassadors: { myAepsEvents: async () => b.EVENTS_1B, aepsOversight: async () => b.EVENTS_1B },
  };
  return { opsClient: () => client, anonClient: () => client };
});

import RootLayout from '../app/layout';
import DashboardPage from '../app/dashboard/page';
import PayoutPage from '../app/payout/page';
import AepsExceptionsPage from '../app/aeps/exceptions/page';
import ErrorBoundary from '../app/error';
import { getLang, getLanguageDef, getTranslator, LANG_COOKIE } from '../lib/i18n';
import { ACCESS_COOKIE } from '../lib/auth';
import { MaintRecorded } from '../components/ops4/UpkeepViews';
import { AlertIncidentView } from '../components/ops5/AlertViews';
import * as moneyModule from '../features/rtl/money';
import * as spanModule from '../features/rtl/span';
import { BREACH } from './ops5a-fixtures';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { ar } from '../i18n/ar';

// ---- helpers ---------------------------------------------------------------------------------------------------------------------------
type Who = { cookie?: string; accept?: string };
function as(who: Who) {
  mockReq.cookies = { [ACCESS_COOKIE]: 'tok', ...(who.cookie ? { [LANG_COOKIE]: who.cookie } : {}) };
  mockReq.headers = who.accept ? { 'accept-language': who.accept } : {};
}
async function page(who: Who, mount: () => Promise<React.ReactNode>): Promise<string> {
  as(who);
  const children = await mount();
  return renderToStaticMarkup(<RootLayout>{children}</RootLayout>);
}
const home = () => DashboardPage();
const payout = () => PayoutPage({ searchParams: {} });
const exceptions = () => AepsExceptionsPage({ searchParams: {} });
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const htmlTag = (html: string) => html.match(/<html[^>]*>/)?.[0] ?? '';
const main = (html: string) => html.match(/<main[^>]*>([\s\S]*)<\/main>/)?.[1] ?? '';
const BANNER = /<div class="kv-md-banner" role="note" data-kv-md-banner="ar"><p lang="ar" dir="rtl">/;
const ARABIC = /[؀-ۿ]/;
const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/;
const LRI = '⁦'; const PDI = '⁩';
/** Every money run in the page body (LRI…PDI holding a ₹) and how many "₹" are left OUTSIDE any isolate (must be 0 under ar). */
function amounts(html: string): { isolated: string[]; bare: number } {
  const body = main(html);
  const isolated = [...body.matchAll(/⁦([^⁦⁩]*)⁩/g)].map((m) => m[1]).filter((r) => r.includes('₹'));
  const rest = body.replace(/⁦[^⁦⁩]*⁩/g, '');
  return { isolated, bare: (rest.match(/₹/g) ?? []).length };
}
/** The Indian (en-IN) shape: optional sign, symbol first, lakh grouping, 2 decimals. */
const INDIAN = /^[-+−]?₹(?:\d{1,2},(?:\d{2},)*\d{3}|\d{1,3})\.\d{2}$/;
const PAYOUT_AMOUNTS = ['₹8,123.45', '₹432.10', '₹7,691.35', '₹5,010.00', '₹0.00', '₹3,333.00', '₹111.00', '₹3,222.00', '₹9,00,71,99,25,47,409.93'];

beforeEach(() => { as({}); });

// ---- 1 · resolution ----------------------------------------------------------------------------------------------------------------------
describe('1 · the ops console serves Arabic only from an explicit choice (founder Q1 "opt-in only")', () => {
  it('the kvo_lang cookie `ar` (set by the switcher or ?lang=) → ar, rtl, Western-digit Intl tag', () => {
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
  it('en / hi / gu resolve exactly as before; a coming-soon code is still refused', () => {
    for (const code of ['en', 'hi', 'gu']) {
      as({ cookie: code }); expect(getLanguageDef()).toMatchObject({ code, dir: 'ltr' });
      as({ accept: code }); expect(getLanguageDef()).toMatchObject({ code, dir: 'ltr' });
    }
    as({ cookie: 'ur' }); expect(getLang()).toBe('en');
  });
});

// ---- 2 · the shell -----------------------------------------------------------------------------------------------------------------------
describe('2 · the shell under Arabic: <html dir>, the machine-draft banner, the chrome, the switcher', () => {
  it('<html lang="ar" dir="rtl"> comes from the resolution; the banner says it is a machine draft, in Arabic AND English, above the shell', async () => {
    const html = await page({ cookie: 'ar' }, home);
    expect(htmlTag(html)).toMatch(/ lang="ar"/);
    expect(htmlTag(html)).toMatch(/ dir="rtl"/);
    expect(html).toMatch(BANNER);
    expect(html).toContain(`<p lang="ar" dir="rtl">${esc(ar['rtl.draftBanner'])}</p>`);
    expect(html).toContain('<p lang="en" dir="ltr">This Arabic text is a machine draft and has not been reviewed.</p>');
    expect(html.indexOf('kv-md-banner')).toBeLessThan(html.indexOf('class="kv-shell"'));
    expect(html.indexOf('kv-md-banner')).toBeLessThan(html.indexOf('class="kv-sidebar"'));
    expect(html.indexOf('kv-md-banner')).toBeGreaterThan(html.indexOf('class="kv-skip"'));
  });
  it('the chrome is Arabic: the skip link, the brand, the primary-nav label, the nav links and sign-out', async () => {
    const html = await page({ cookie: 'ar' }, home);
    for (const k of ['common.skipToContent', 'nav.brand', 'nav.primary', 'nav.dashboard', 'nav.payout', 'nav.signOut', 'lang.label']) {
      expect({ k, ar: html.includes(esc(ar[k])) }).toEqual({ k, ar: true });
      expect({ k, en: html.includes(`>${esc(en[k])}<`) || html.includes(`"${esc(en[k])}"`) }).toEqual({ k, en: false });
    }
  });
  it('the switcher offers Arabic as a labelled machine draft (pressed under ar), out of the coming-soon group', async () => {
    const enHtml = await page({ cookie: 'en' }, home);
    expect(enHtml).toContain('<button type="submit" name="lang" value="ar" aria-pressed="false" class="kv-locale__btn kv-locale__btn--draft"><bdi lang="ar" dir="rtl">العربية</bdi> <span class="kv-locale__draft">(machine draft)</span></button>');
    expect(enHtml).not.toMatch(/class="kv-locale__soon"[^>]*>العربية/);
    const arHtml = await page({ cookie: 'ar' }, home);
    expect(arHtml).toContain('<button type="submit" name="lang" value="ar" aria-pressed="true" class="kv-locale__btn kv-locale__btn--draft is-active"><bdi lang="ar" dir="rtl">العربية</bdi> <span class="kv-locale__draft">(مسودة آلية)</span></button>');
  });
  it('the banner is drawn on the bare (signed-out) surface too', async () => {
    mockReq.cookies = { [LANG_COOKIE]: 'ar' }; mockReq.headers = {};
    const html = renderToStaticMarkup(<RootLayout><p>x</p></RootLayout>);
    expect(html).toMatch(BANNER);
    expect(html).not.toContain('class="kv-sidebar"');
  });
  it('under en / hi / gu and an ar browser preference: dir="ltr" and NO banner', async () => {
    for (const who of [{ cookie: 'en' }, { cookie: 'hi' }, { cookie: 'gu' }, { accept: 'ar' }]) {
      const html = await page(who, home);
      expect(htmlTag(html)).toMatch(/ dir="ltr"/);
      expect(html).not.toContain('kv-md-banner');
      // the only Arabic-script text left is the switcher's own names: Arabic's (the draft choice) and the coming-soon names (Urdu, Kashmiri…)
      expect(ARABIC.test(html.replace(/<bdi lang="ar" dir="rtl">العربية<\/bdi>/g, '').replace(/<span lang="[a-z]+" dir="rtl" class="kv-locale__soon"[^>]*>[^<]*<\/span>/g, ''))).toBe(false);
    }
  });
});

// ---- 3 · the pages -----------------------------------------------------------------------------------------------------------------------
const PAGES: Array<[string, () => Promise<React.ReactNode>, string[]]> = [
  ['/dashboard (the ops home)', home, ['dash.title', 'dash.honesty']],
  ['/payout (the payout run — gross, deductions and net per bill)', payout, ['ops1.payout.title', 'ops1.payout.statement']],
  ['/aeps/exceptions (the AePS events list — ids, kinds, times, amounts)', exceptions, ['ops1.aeps.exceptions.title']],
];

describe('3 · the home, the payout run and the AePS exceptions in Arabic inside the real chrome', () => {
  it.each(PAGES)('%s: dir="rtl", the banner, Arabic copy with the named en strings absent, Western digits, no bare arrow', async (_n, mount, named) => {
    const html = await page({ cookie: 'ar' }, mount);
    expect(htmlTag(html)).toMatch(/ dir="rtl"/);
    expect(html).toMatch(BANNER);
    const body = main(html);
    expect(body.length).toBeGreaterThan(300);
    expect(ARABIC.test(body)).toBe(true);
    for (const k of named) {
      expect({ k, en: html.includes(esc(en[k])) }).toEqual({ k, en: false });
      expect({ k, ar: html.includes(esc(ar[k])) }).toEqual({ k, ar: true });
    }
    expect(Object.keys(ar).filter((k) => html.includes(`>${k}<`))).toEqual([]);
    expect(ARABIC_INDIC_DIGIT.test(html)).toBe(false);
    expect((html.match(/[→←]/g) ?? []).length).toBe(0);
  });

  it.each(PAGES.slice(1))('%s under ar: every amount is isolated (LRI…PDI), in the Indian shape, never "123,456.50 ₹"', async (_n, mount) => {
    const html = await page({ cookie: 'ar' }, mount);
    const a = amounts(html);
    expect(a.isolated.length).toBeGreaterThan(0);
    expect(a.bare).toBe(0);
    expect(a.isolated.filter((x) => !INDIAN.test(x))).toEqual([]);
    expect(main(html)).not.toMatch(/\d\s*₹/);
    expect(main(html)).not.toMatch(/‏-?\d[\d,]*\.\d{2}/);
  });

  it('the exact amounts: every bill figure on /payout (one past 2^53, exact) and the AePS amounts', async () => {
    const p = amounts(await page({ cookie: 'ar' }, payout)).isolated;
    for (const x of PAYOUT_AMOUNTS) expect({ x, in: p.includes(x) }).toEqual({ x, in: true });
    const e = amounts(await page({ cookie: 'ar' }, exceptions)).isolated;
    for (const x of ['₹1,200.00', '₹3,300.00']) expect({ x, in: e.includes(x) }).toEqual({ x, in: true });
  });

  it.each(PAGES.slice(1))('%s under en: the same amounts, en-IN, NO isolation marks, English copy', async (_n, mount, named) => {
    const html = await page({ cookie: 'en' }, mount);
    const body = main(html);
    expect(body).not.toMatch(/[⁦-⁩]/);
    expect(body).toMatch(/₹\d/);
    for (const k of named) expect({ k, en: html.includes(esc(en[k])) }).toEqual({ k, en: true });
  });
});

// ---- 4 · en / hi / gu byte-identical ------------------------------------------------------------------------------------------------------
// The whole rendered page with the RTL-1e helpers as built, and the same render with them swapped back to the 94d07840 calls: `moneyText`
// (by name and through the six views' alias) → the bare `formatMoneyMinor(…, lang)`, `ltrText` → the text itself. Under en/hi/gu the two are
// identical to the byte; under ar they differ (so the comparison can see a change).
async function nowAndBefore(cookie: string, mount: () => Promise<React.ReactNode>): Promise<[string, string]> {
  const now = await page({ cookie }, mount);
  const m = jest.spyOn(moneyModule, 'moneyText').mockImplementation((x, c, l) => formatMoneyMinor(x, c, l));
  const s = jest.spyOn(spanModule, 'ltrText').mockImplementation((x) => x);
  try { return [now, await page({ cookie }, mount)]; } finally { m.mockRestore(); s.mockRestore(); }
}
describe('4 · under en / hi / gu every page is BYTE-IDENTICAL to the bare 94d07840 calls', () => {
  it.each(PAGES.slice(1))('%s', async (_n, mount) => {
    for (const cookie of ['en', 'hi', 'gu']) {
      const [now, before] = await nowAndBefore(cookie, mount);
      expect({ cookie, same: now === before }).toEqual({ cookie, same: true });
      expect(now).toMatch(/₹\d/);
    }
    const [arNow, arBefore] = await nowAndBefore('ar', mount);
    expect(arNow).not.toBe(arBefore);
    expect(main(arBefore)).not.toContain(LRI);
  });
  it('hi is still Hindi (the payout title) with no banner', async () => {
    const html = await page({ cookie: 'hi' }, payout);
    expect(html).toContain(esc(hi['ops1.payout.title']));
    expect(html).not.toContain('kv-md-banner');
  });
});

// ---- 5 · codes in Arabic sentences; the error boundary ------------------------------------------------------------------------------------
describe('5 · codes inside Arabic sentences are isolated; the error boundary reads the cookie as a choice', () => {
  it('the maintenance entry\'s server id inside the Arabic sentence is one isolated run; under en the sentence is unchanged', () => {
    const entry = { id: '0192d2c4-c001-7000-8000-00000000abcd', logType: 'service', performedOn: '2026-11-01', engineHoursAt: null, costMinor: '150000' } as never;
    as({ cookie: 'ar' });
    const a = renderToStaticMarkup(<MaintRecorded t={getTranslator()} lang="ar" entry={entry} machine="x" />);
    expect(a).toContain(esc(ar['ops4.upkeep.recordedId'].replace('{id}', `${LRI}0192d2c4-c001-7000-8000-00000000abcd${PDI}`)));
    expect(a).toContain(`${LRI}₹1,500.00${PDI}`);
    as({ cookie: 'en' });
    const e = renderToStaticMarkup(<MaintRecorded t={getTranslator()} lang="en" entry={entry} machine="x" />);
    expect(e).toContain(esc(en['ops4.upkeep.recordedId'].replace('{id}', '0192d2c4-c001-7000-8000-00000000abcd')));
    expect(e).not.toMatch(/[⁦-⁩]/);
  });
  it('the incident\'s subject reference and a recorded loss are isolated inside the Arabic sentences', () => {
    const breach = { ...BREACH, subjectRef: 'LOT-2026-0042', device: { id: 'd-1', serial: 'LG-0007' } };
    as({ cookie: 'ar' });
    const html = renderToStaticMarkup(<AlertIncidentView t={getTranslator()} lang="ar" state="ok" id={BREACH.id} breach={breach} />);
    expect(html).toContain(`${LRI}LOT-2026-0042${PDI}`);
    expect(html).toContain(`${LRI}LG-0007${PDI}`);
    expect(html).toContain(`${LRI}₹1,250.50${PDI}`);
    as({ cookie: 'en' });
    expect(renderToStaticMarkup(<AlertIncidentView t={getTranslator()} lang="en" state="ok" id={BREACH.id} breach={breach} />)).not.toMatch(/[⁦-⁩]/);
  });
  it('app/error.tsx: kvo_lang=ar → the Arabic words; hi as before; a coming-soon or absent cookie → English', () => {
    const g = globalThis as unknown as { document?: { cookie: string } };
    const render = (cookie: string) => { g.document = { cookie }; try { return renderToStaticMarkup(<ErrorBoundary error={new Error('x')} reset={() => undefined} />); } finally { delete g.document; } };
    expect(render(`${LANG_COOKIE}=ar`)).toContain(`<h1>${esc(ar['common.errorTitle'])}</h1>`);
    expect(render(`a=1; ${LANG_COOKIE}=hi`)).toContain(`<h1>${esc(hi['common.errorTitle'])}</h1>`);
    expect(render(`${LANG_COOKIE}=ur`)).toContain(`<h1>${esc(en['common.errorTitle'])}</h1>`);
    expect(render('')).toContain(`<h1>${esc(en['common.errorTitle'])}</h1>`);
  });
});
