// apps/web-gov/src/test-render/rtl-ar.render.test.tsx · PC-56 RTL-1f · THE PROOF for the government console (web-tenant's RTL-1b / web-ops's
// RTL-1e rtl-ar.render, adapted).
//
// What every earlier gov rtl test (rtl-gov1a … rtl-gov6b) did NOT do: render real ARABIC copy, with `dir` coming from the app's OWN language
// resolution — not a hand-placed dir="rtl", and not a hand-built translator. Here only the request is faked (`next/headers`: the `kvg_lang`
// cookie, the session cookie, the pending-phone cookie, the Accept-Language header) and the API answers with the existing render fixtures;
// the REAL `lib/i18n` resolves the language, the REAL root layout draws <html lang dir>, the machine-draft banner, the REAL GovShell and the
// REAL Sidebar (with the REAL LocaleSwitcher), and the REAL pages are mounted inside: the desk (`/dashboard` — the server's counts and the
// instant it counted them), the applications list (`/applications` — application numbers, scheme codes, instants), MGNREGA (`/mgnrega`) and
// the sign-in's code step (`/login?step=verify` — the masked phone inside a sentence).
//
// Asserted (founder Q1/Q2/Q4, brief_rtl1f.md §D):
//   1. resolution — cookie `ar` → Arabic, rtl; Accept-Language `ar` → ENGLISH (opt-in only); en/hi/gu unchanged;
//   2. the shell — <html lang="ar" dir="rtl">, the banner (role="note") in Arabic AND English, after the skip link and above the shell; none
//      under en/hi/gu; the switcher offers Arabic as a labelled machine draft;
//   3. the pages — Arabic text with named en strings absent, Western digits, no arrow; codes, the masked phone and instants isolated;
//      the gov console prints no amount, so there is none to shape (no "₹" anywhere);
//   4. under en/hi/gu every page is BYTE-IDENTICAL to the same render with the RTL-1f isolate swapped back to the aead5db3 text;
//   5. the error boundary reads the cookie the same way (ar explicit, nothing else invented).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// ---- the request: the only thing faked about language --------------------------------------------------------------------------------------
const mockReq: { cookies: Record<string, string>; headers: Record<string, string> } = { cookies: {}, headers: {} };
jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => ({
  cookies: () => ({ get: (n: string) => (n in mockReq.cookies ? { name: n, value: mockReq.cookies[n] } : undefined), has: (n: string) => n in mockReq.cookies, set: () => undefined, delete: () => undefined }),
  headers: () => new Headers(mockReq.headers),
}));
jest.mock('next/navigation', () => ({ ...jest.requireActual('next/navigation'),
  usePathname: () => '/dashboard', useSearchParams: () => null,
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('../styles/globals.css', () => ({}), { virtual: true });

// ---- the session and the data (the existing GOV-1a / GOV-1b / GOV-2b / GOV-2c fixtures) ----------------------------------------------------
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya' } }));
jest.mock('../lib/api-client', () => {
  const a = jest.requireActual('./gov1a-fixtures'); const b = jest.requireActual('./gov1b-fixtures');
  const s = jest.requireActual('./gov2b-fixtures'); const c = jest.requireActual('./gov2c-fixtures');
  const client = {
    gov: {
      me: async () => a.ME_HEAD,
      overview: async () => b.OVERVIEW,
      applications: { list: async () => ({ items: c.LIST, nextCursor: null }) },
      schemes: { list: async () => s.SCHEMES },
    },
    request: async () => ({ data: { gov_console: true } }),
  };
  return { govClient: () => client, anonClient: () => client };
});

import RootLayout from '../app/layout';
import DashboardPage from '../app/dashboard/page';
import ApplicationsPage from '../app/applications/page';
import MgnregaPage from '../app/mgnrega/page';
import LoginPage from '../app/login/page';
import ErrorBoundary from '../app/error';
import { getLang, getLanguageDef, getTranslator, LANG_COOKIE } from '../lib/i18n';
import { ACCESS_COOKIE } from '../lib/auth';
import { AccessView } from '../components/gov1/AccessViews';
import * as spanModule from '../features/rtl/span';
import { ME_HEAD, ROWS } from './gov1a-fixtures';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { ar } from '../i18n/ar';

// ---- helpers ---------------------------------------------------------------------------------------------------------------------------
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const GOV_TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ME_HEAD.person.userId, aid: ME_HEAD.authority!.id, realm: 'gov', typ: 'gov_access', roles: ['authority_head'], perms: [] })}.sig`;
type Who = { cookie?: string; accept?: string; signedOut?: boolean; phone?: string };
function as(who: Who) {
  mockReq.cookies = {
    ...(who.signedOut ? {} : { [ACCESS_COOKIE]: GOV_TOKEN }),
    ...(who.cookie ? { [LANG_COOKIE]: who.cookie } : {}),
    ...(who.phone ? { kvg_pending_phone: who.phone } : {}),
  };
  mockReq.headers = who.accept ? { 'accept-language': who.accept } : {};
}
type Mount = { who?: Partial<Who>; run: () => Promise<React.ReactNode> };
async function page(who: Who, m: Mount): Promise<string> {
  as({ ...who, ...(m.who ?? {}) });
  const children = await m.run();
  return renderToStaticMarkup(await RootLayout({ children }));
}
const home: Mount = { run: () => DashboardPage({ searchParams: {} }) };
const apps: Mount = { run: () => ApplicationsPage({ searchParams: {} }) };
const mgnrega: Mount = { run: () => MgnregaPage({ searchParams: {} }) };
const login: Mount = { who: { signedOut: true, phone: '+91 98765 43318' }, run: () => LoginPage({ searchParams: { step: 'verify' } }) };
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const htmlTag = (html: string) => html.match(/<html[^>]*>/)?.[0] ?? '';
const main = (html: string) => html.match(/<main[^>]*>([\s\S]*)<\/main>/)?.[1] ?? '';
const BANNER = /<div class="kv-md-banner" role="note" data-kv-md-banner="ar"><p lang="ar" dir="rtl">/;
const ARABIC = /[؀-ۿ]/;
const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/;
const LRI = '⁦'; const PDI = '⁩';
const iso = (s: string) => `${LRI}${s}${PDI}`;

beforeEach(() => { as({}); });

// ---- 1 · resolution ----------------------------------------------------------------------------------------------------------------------
describe('1 · the gov console serves Arabic only from an explicit choice (founder Q1 "opt-in only")', () => {
  it('the kvg_lang cookie `ar` (set by the switcher or ?lang=) → ar, rtl, Western-digit Intl tag', () => {
    as({ cookie: 'ar' });
    expect(getLang()).toBe('ar');
    expect(getLanguageDef()).toMatchObject({ code: 'ar', dir: 'rtl', intlLocale: 'ar-AE-u-nu-latn' });
  });
  it('an Accept-Language `ar` browser with no cookie gets ENGLISH — never Arabic from a browser preference', async () => {
    for (const accept of ['ar', 'ar-AE', 'ar-AE,ar;q=0.9,en;q=0.8']) {
      as({ accept });
      expect(getLang()).toBe('en');
      expect(getLanguageDef().dir).toBe('ltr');
    }
    const html = await page({ accept: 'ar' }, apps);
    expect(htmlTag(html)).toMatch(/ lang="en" dir="ltr"/);
    expect(html).toContain(esc(en['gov2.apps.title']));
    expect(html).not.toContain('kv-md-banner');
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
  it('<html lang="ar" dir="rtl"> comes from the resolution; the banner says it is a machine draft, in Arabic AND English, after the skip link, above the shell', async () => {
    const html = await page({ cookie: 'ar' }, home);
    expect(htmlTag(html)).toMatch(/ lang="ar"/);
    expect(htmlTag(html)).toMatch(/ dir="rtl"/);
    expect(html).toMatch(BANNER);
    expect(html).toContain(`<p lang="ar" dir="rtl">${esc(ar['rtl.draftBanner'])}</p>`);
    expect(html).toContain('<p lang="en" dir="ltr">This Arabic text is a machine draft and has not been reviewed.</p>');
    expect(html.indexOf('kv-md-banner')).toBeLessThan(html.indexOf('class="kv-shell"'));
    expect(html.indexOf('kv-md-banner')).toBeLessThan(html.indexOf('class="kv-sidebar"'));
    expect(html.indexOf('kv-md-banner')).toBeGreaterThan(html.indexOf('class="kv-skip"'));
    expect(html).toContain('data-kv-shell="gov"');
  });
  it('the chrome is Arabic: the skip link, the brand line, the primary-nav label, the nav links, sign-out and the footer link', async () => {
    const html = await page({ cookie: 'ar' }, home);
    for (const k of ['common.skipToContent', 'nav.brand', 'nav.primary', 'nav.dashboard', 'gov2.nav.applications', 'gov1.nav.access', 'nav.signOut', 'lang.label', 'gov1.footer.chrome']) {
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
  it('the banner is drawn on the bare (signed-out) surface too — the sign-in page', async () => {
    const html = await page({ cookie: 'ar' }, login);
    expect(html).toMatch(BANNER);
    expect(html).toContain('data-kv-shell="bare"');
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
const PAGES: Array<[string, Mount, string[]]> = [
  ['/dashboard (the desk — the server\'s counts and when it counted them)', home, ['gov1.dash.title', 'gov1.dash.q3', 'gov1.dash.countsOnly']],
  ['/applications (application numbers, scheme codes, instants)', apps, ['gov2.apps.title', 'gov2.apps.lead', 'gov2.apps.col.application']],
  ['/mgnrega (what this console does not do for MGNREGA)', mgnrega, ['gov5.q3', 'gov5.q2', 'gov5.notDone.title']],
  ['/login?step=verify (the code step — the masked phone)', login, ['login.title', 'gov1.login.lead', 'gov1.login.q5']],
];

describe('3 · the desk, the applications list, MGNREGA and the sign-in in Arabic inside the real chrome', () => {
  it.each(PAGES)('%s: dir="rtl", the banner, Arabic copy with the named en strings absent, Western digits, no arrow, no amount', async (_n, m, named) => {
    const html = await page({ cookie: 'ar' }, m);
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
    expect(html).not.toContain('₹');
  });

  it('/dashboard under ar: the counts are the server\'s, Western digits; the instant the server counted is ONE isolated run in the Arabic sentence', async () => {
    const body = main(await page({ cookie: 'ar' }, home));
    expect(body).toContain(esc(ar['gov1.dash.computedAt'].replace('{at}', iso('2026-11-10 06:30 UTC'))));
    expect(body).toContain(esc(ar['gov1.dash.applications'].replace('{n}', '64')));
    expect(body).toContain('<td data-kv-n="7">7</td>');
  });

  it('/applications under ar: every scheme code (filter and rows) and every instant is isolated; the application numbers are alone in their cell', async () => {
    const body = main(await page({ cookie: 'ar' }, apps));
    expect((body.match(new RegExp(`\\(${iso('test_scheme_a')}\\)`, 'g')) ?? []).length).toBe(4);   // 1 filter option (scheme A) + 3 rows
    expect(body).toContain(`(${iso('test_scheme_b')})`);
    expect(body).not.toMatch(/\(test_scheme_[ab]\)/);
    expect((body.match(new RegExp(iso('2026-10-05 06:00 UTC'), 'g')) ?? []).length).toBe(3);
    expect(body).toContain(iso('2026-10-09 07:30 UTC'));
    expect(body).not.toMatch(/[^⁦]2026-10-0\d \d\d:\d\d UTC/);
    for (const id of ['0192D2C4']) expect(body).toMatch(new RegExp(`data-kv-open="[^"]+">${id}</a>`));
  });

  it('/login?step=verify under ar: the masked phone is ONE isolated run inside the Arabic sentence; under en the sentence is unchanged', async () => {
    const a = main(await page({ cookie: 'ar' }, login));
    expect(a).toContain(esc(ar['gov1.login.codeSent'].replace('{phone}', iso('••••••318'))));
    expect(a).not.toMatch(/[^⁦]••••••318/);
    const e = main(await page({ cookie: 'en' }, login));
    expect(e).toContain(esc(en['gov1.login.codeSent'].replace('{phone}', '••••••318')));
    expect(e).not.toMatch(/[⁦-⁩]/);
  });

  it.each(PAGES)('%s under en: English copy, NO isolation marks', async (_n, m, named) => {
    const html = await page({ cookie: 'en' }, m);
    expect(main(html)).not.toMatch(/[⁦-⁩]/);
    for (const k of named) expect({ k, en: html.includes(esc(en[k])) }).toEqual({ k, en: true });
  });
});

// ---- 4 · en / hi / gu byte-identical ------------------------------------------------------------------------------------------------------
// The whole rendered page with the RTL-1f isolate as built, and the same render with it swapped back to the aead5db3 text (`ltrText` and
// `ltrOrNull` → the value itself). Under en/hi/gu the two are identical to the byte; under ar they differ (so the comparison can see a change).
async function nowAndBefore(cookie: string, m: Mount): Promise<[string, string]> {
  const now = await page({ cookie }, m);
  const a = jest.spyOn(spanModule, 'ltrText').mockImplementation((x) => x);
  const b = jest.spyOn(spanModule, 'ltrOrNull').mockImplementation((x) => x);
  try { return [now, await page({ cookie }, m)]; } finally { a.mockRestore(); b.mockRestore(); }
}
describe('4 · under en / hi / gu every page is BYTE-IDENTICAL to the aead5db3 text', () => {
  it.each(PAGES.filter((p) => p[1] !== mgnrega))('%s', async (_n, m) => {
    for (const cookie of ['en', 'hi', 'gu']) {
      const [now, before] = await nowAndBefore(cookie, m);
      expect({ cookie, same: now === before }).toEqual({ cookie, same: true });
    }
    const [arNow, arBefore] = await nowAndBefore('ar', m);
    expect(arNow).not.toBe(arBefore);
    expect(main(arBefore)).not.toContain(LRI);
  });
  it('hi is still Hindi (the applications title) with no banner', async () => {
    const html = await page({ cookie: 'hi' }, apps);
    expect(html).toContain(esc(hi['gov2.apps.title']));
    expect(html).not.toContain('kv-md-banner');
  });
});

// ---- 5 · the access page's instants; the error boundary -----------------------------------------------------------------------------------
describe('5 · instants inside Arabic sentences on the access page; the error boundary reads the cookie as a choice', () => {
  it('the access-ends instant in the signed-in sentence, each row\'s end and a removal date are isolated under ar only', () => {
    as({ cookie: 'ar' });
    const a = renderToStaticMarkup(<AccessView t={getTranslator()} lang="ar" state="ok" me={ME_HEAD} rows={ROWS} />);
    expect(a).toContain(esc(ar['gov1.access.signedIn'].replace('{authority}', 'Test Authority One').replace('{ends}', iso('2027-11-10 06:30 UTC'))));
    expect(a).toContain(esc(ar['gov1.access.removedOn'].replace('{at}', iso('2026-11-05 05:00 UTC'))));
    expect(a).toContain(`<td>${iso('2027-11-01 05:00 UTC')}</td>`);
    as({ cookie: 'en' });
    const e = renderToStaticMarkup(<AccessView t={getTranslator()} lang="en" state="ok" me={ME_HEAD} rows={ROWS} />);
    expect(e).toContain(esc(en['gov1.access.removedOn'].replace('{at}', '2026-11-05 05:00 UTC')));
    expect(e).not.toMatch(/[⁦-⁩]/);
  });
  it('app/error.tsx: kvg_lang=ar → the Arabic words; hi as before; a coming-soon or absent cookie → English', () => {
    const g = globalThis as unknown as { document?: { cookie: string } };
    const render = (cookie: string) => { g.document = { cookie }; try { return renderToStaticMarkup(<ErrorBoundary error={new Error('x')} reset={() => undefined} />); } finally { delete g.document; } };
    expect(render(`${LANG_COOKIE}=ar`)).toContain(`<h1>${esc(ar['common.errorTitle'])}</h1>`);
    expect(render(`a=1; ${LANG_COOKIE}=hi`)).toContain(`<h1>${esc(hi['common.errorTitle'])}</h1>`);
    expect(render(`${LANG_COOKIE}=ur`)).toContain(`<h1>${esc(en['common.errorTitle'])}</h1>`);
    expect(render('')).toContain(`<h1>${esc(en['common.errorTitle'])}</h1>`);
  });
});
