// apps/web-partner/src/test-render/rtl-ar.render.test.tsx · PC-56 RTL-1d · THE PROOF for the partner console (web-tenant's RTL-1b / the
// storefront's RTL-1c rtl-ar.render, adapted).
//
// What every earlier partner rtl test did NOT do: render real ARABIC copy, with `dir` coming from the app's OWN language resolution — not a
// hand-placed dir="rtl", and not a mocked lib/i18n. Here only the request is faked (`next/headers`: the `kv_lang` cookie, the session cookie,
// the Accept-Language header) and the API answers with the existing render fixtures; the REAL `lib/i18n` resolves the language, the REAL root
// layout draws <html lang dir>, the machine-draft banner and the REAL Sidebar chrome, and the REAL pages are mounted inside: the lender's home
// (`/dashboard`), the money-heavy loan book (`/lender/portfolio` — counts by kind, outstanding and principal per loan) and the application queue
// (`/lender/queue` — a list of references, products and amounts).
//
// Asserted (founder Q1/Q2/Q4 + the lead's money shape, brief_rtl1d.md §D):
//   1. resolution — cookie `ar` → Arabic, rtl; Accept-Language `ar` → ENGLISH (opt-in only); en/hi/gu unchanged;
//   2. the shell — <html lang="ar" dir="rtl">, the banner (role="note") in Arabic AND English, above the chrome; none under en/hi/gu;
//   3. the pages — Arabic text with named en strings absent, every amount Indian-shaped + isolated, Western digits, no bare arrow;
//   4. under en/hi/gu the pages are BYTE-IDENTICAL to the same render with the RTL-1d helpers swapped back to the b77c7f0f calls;
//   5. the language choice offers Arabic as a labelled machine draft; a phone number inside an Arabic sentence is isolated.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatMoneyMinor } from '@krishalaya/i18n';

// ---- the request: the only thing faked about language --------------------------------------------------------------------------------------
const mockReq: { cookies: Record<string, string>; headers: Record<string, string> } = { cookies: {}, headers: {} };
jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => ({
  cookies: () => ({ get: (n: string) => (n in mockReq.cookies ? { name: n, value: mockReq.cookies[n] } : undefined), has: (n: string) => n in mockReq.cookies, set: () => undefined }),
  headers: () => new Headers(mockReq.headers),
}));
jest.mock('next/navigation', () => ({ ...jest.requireActual('next/navigation'),
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('../styles/globals.css', () => ({}), { virtual: true });

// ---- the session and the data (the existing PARTNER-1a / PARTNER-4a fixtures) ---------------------------------------------------------------
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', isProduction: false } }));
jest.mock('../lib/session', () => ({ requirePartner: async () => ({ sub: 'u-1', perms: ['partner.applications.read'] }), resolveSessionToken: async () => 'tok' }));
jest.mock('../lib/api-client', () => {
  const a = jest.requireActual('./partner1a-fixtures'); const b = jest.requireActual('./partner4a-fixtures');
  const client = {
    partner: {
      me: async () => a.ME,
      dashboard: async () => a.FIGURES,
      loans: { counts: async () => b.COUNTS, list: async () => ({ items: b.LOANS, nextCursor: null, computedAt: '2026-10-28T06:30:00.000Z' }) },
      applications: { list: async () => ({ items: b.APPLICATIONS, nextCursor: null, asOf: '2026-10-28T06:30:00.000Z' }) },
    },
  };
  return { partnerClient: () => client, anonClient: () => client };
});

import RootLayout from '../app/layout';
import PartnerDashboard from '../app/dashboard/page';
import LenderPortfolioPage from '../app/lender/portfolio/page';
import LenderQueuePage from '../app/lender/queue/page';
import { Sidebar } from '../components/Sidebar';
import { AccountNotificationPrefsView } from '../components/partner6/AccountNotificationPrefsView';
import { AccountChain6 } from '../components/partner6/AccountChain6';
import { LoginSteps } from '../components/LoginSteps';
import { getLang, getLanguageDef, getTranslator } from '../lib/i18n';
import { LANGUAGE_CHOICES, PREVIEW_CHOICES } from '../features/partner6/language';
import * as moneyModule from '../features/rtl/money';
import * as spanModule from '../features/rtl/span';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { ar } from '../i18n/ar';

// ---- helpers ---------------------------------------------------------------------------------------------------------------------------
type AnyFn = (props: any) => unknown;   // eslint-disable-line @typescript-eslint/no-explicit-any -- a component of any props shape
/** react-dom 18's server renderer cannot render an ASYNC server component; the layout nests one (Sidebar reads /me). Resolve the named ones. */
async function resolveTree(node: React.ReactNode, asyncTypes: ReadonlyArray<AnyFn>): Promise<React.ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map((n) => resolveTree(n, asyncTypes)));
  if (!React.isValidElement(node)) return node;
  const el = node as React.ReactElement<{ children?: React.ReactNode }>;
  if (typeof el.type === 'function' && asyncTypes.includes(el.type as AnyFn)) return resolveTree((await (el.type as AnyFn)(el.props)) as React.ReactNode, asyncTypes);
  if (el.props && 'children' in el.props) {
    const children = await resolveTree(el.props.children, asyncTypes);
    return React.cloneElement(el, undefined, ...(Array.isArray(children) ? children : [children]));
  }
  return el;
}
// A session token whose perms show the Lending group (persona only — the API is the authority).
const TOKEN = `x.${Buffer.from(JSON.stringify({ perms: ['partner.applications.read'] })).toString('base64url')}.y`;
type Who = { cookie?: string; accept?: string };
function as(who: Who) {
  mockReq.cookies = { kvp_access: TOKEN, ...(who.cookie ? { kv_lang: who.cookie } : {}) };
  mockReq.headers = who.accept ? { 'accept-language': who.accept } : {};
}
async function page(who: Who, mount: () => Promise<React.ReactNode>): Promise<string> {
  as(who);
  const children = await mount();
  return renderToStaticMarkup(<>{await resolveTree(RootLayout({ children: children as React.ReactElement }), [Sidebar])}</>);
}
const home = () => PartnerDashboard({ searchParams: {} });
const book = () => LenderPortfolioPage({ searchParams: {} });
const queue = () => LenderQueuePage({ searchParams: {} });
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const htmlTag = (html: string) => html.match(/<html[^>]*>/)?.[0] ?? '';
const main = (html: string) => html.match(/<main[^>]*>([\s\S]*)<\/main>/)?.[1] ?? '';
const BANNER = /<div class="kv-md-banner" role="note" data-kv-md-banner="ar"><p lang="ar" dir="rtl">/;
const ARABIC = /[؀-ۿ]/;
const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/;
const LRI = '⁦'; const PDI = '⁩';
/** Bare horizontal arrows left after removing the ar catalogue's own (reversed) arrows. */
function bareArrows(html: string): number {
  let rest = html;
  for (const v of Object.values(ar).filter((x) => x.includes('←'))) rest = rest.split(esc(v)).join('');
  return (rest.match(/[→←]/g) ?? []).length;
}
/** Every money run in the page body (LRI…PDI holding a ₹) and how many "₹" are left OUTSIDE any isolate (must be 0 under ar). */
function amounts(html: string): { isolated: string[]; bare: number } {
  const body = main(html);
  const isolated = [...body.matchAll(/⁦([^⁦⁩]*)⁩/g)].map((m) => m[1]).filter((r) => r.includes('₹'));
  const rest = body.replace(/⁦[^⁦⁩]*⁩/g, '');
  return { isolated, bare: (rest.match(/₹/g) ?? []).length };
}
/** The Indian (en-IN) shape: optional sign, symbol first, lakh grouping, 2 decimals. */
const BOOK_AMOUNTS = ['₹1,38,410.00', '₹1,60,000.00', '₹9,00,71,99,25,47,409.93', '₹11,000.00'];
const INDIAN = /^[-+−]?₹(?:\d{1,2},(?:\d{2},)*\d{3}|\d{1,3})\.\d{2}$/;

beforeEach(() => { as({}); });

// ---- 1 · resolution ----------------------------------------------------------------------------------------------------------------------
describe('1 · the partner console serves Arabic only from an explicit choice (founder Q1 "opt-in only")', () => {
  it('the kv_lang cookie `ar` (set by the language choice) → ar, rtl, Western-digit Intl tag', () => {
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
describe('2 · the shell under Arabic: <html dir>, the machine-draft banner, the chrome', () => {
  it('<html lang="ar" dir="rtl"> comes from the resolution; the banner says it is a machine draft, in Arabic AND English, above the chrome', async () => {
    const html = await page({ cookie: 'ar' }, home);
    expect(htmlTag(html)).toMatch(/ lang="ar"/);
    expect(htmlTag(html)).toMatch(/ dir="rtl"/);
    expect(html).toMatch(BANNER);
    expect(html).toContain(`<p lang="ar" dir="rtl">${esc(ar['rtl.draftBanner'])}</p>`);
    expect(html).toContain('<p lang="en" dir="ltr">This Arabic text is a machine draft and has not been reviewed.</p>');
    expect(html.indexOf('kv-md-banner')).toBeLessThan(html.indexOf('class="kv-sidebar"'));
    expect(html.indexOf('kv-md-banner')).toBeGreaterThan(html.indexOf('class="kv-skip"'));
  });
  it('the chrome is Arabic: the skip link, the sidebar\'s realm, primary-nav label and Lending links', async () => {
    const html = await page({ cookie: 'ar' }, home);
    for (const k of ['common.backToDashboard', 'nav.brand', 'nav.primary']) {
      expect({ k, ar: html.includes(esc(ar[k])) }).toEqual({ k, ar: true });
      expect({ k, en: html.includes(`>${esc(en[k])}<`) || html.includes(`"${esc(en[k])}"`) }).toEqual({ k, en: false });
    }
  });
  it('the banner is drawn on the bare (signed-out) surface too', async () => {
    mockReq.cookies = { kv_lang: 'ar' }; mockReq.headers = {};
    const html = renderToStaticMarkup(<>{await resolveTree(RootLayout({ children: <p>x</p> }), [Sidebar])}</>);
    expect(html).toMatch(BANNER);
    expect(html).toContain('kv-content--bare');
  });
  it('under en / hi / gu and an ar browser preference: dir="ltr" and NO banner, no Arabic', async () => {
    for (const who of [{ cookie: 'en' }, { cookie: 'hi' }, { cookie: 'gu' }, { accept: 'ar' }]) {
      const html = await page(who, home);
      expect(htmlTag(html)).toMatch(/ dir="ltr"/);
      expect(html).not.toContain('kv-md-banner');
      expect(ARABIC.test(html)).toBe(false);
    }
  });
});

// ---- 3 · the pages -----------------------------------------------------------------------------------------------------------------------
const PAGES: Array<[string, () => Promise<React.ReactNode>, string[]]> = [
  ['/dashboard (the lender\'s home)', home, ['partner1.dash.title', 'partner1.dash.noPunctuality']],
  ['/lender/portfolio (the loan book — money by kind and per loan)', book, ['partner4.portfolio.title']],
  ['/lender/queue (the application queue — references, products, amounts)', queue, ['partner4.queue.title']],
];

describe('3 · the home, the loan book and the queue in Arabic inside the real chrome', () => {
  it.each(PAGES)('%s: dir="rtl", the banner, Arabic copy with the named en strings absent, Western digits, no bare arrow', async (_n, mount, named) => {
    const html = await page({ cookie: 'ar' }, mount);
    expect(htmlTag(html)).toMatch(/ dir="rtl"/);
    expect(html).toMatch(BANNER);
    const body = main(html);
    expect(body.length).toBeGreaterThan(500);
    expect(ARABIC.test(body)).toBe(true);
    for (const k of named) {
      expect({ k, en: html.includes(esc(en[k])) }).toEqual({ k, en: false });
      expect({ k, ar: html.includes(esc(ar[k])) }).toEqual({ k, ar: true });
    }
    // no raw key id leaked (a key with no value anywhere renders as itself)
    expect(Object.keys(ar).filter((k) => html.includes(`>${k}<`))).toEqual([]);
    expect(ARABIC_INDIC_DIGIT.test(html)).toBe(false);
    expect(bareArrows(html)).toBe(0);
  });

  it.each(PAGES)('%s under ar: every amount is isolated (LRI…PDI), in the Indian shape, never "123,456.50 ₹"', async (_n, mount) => {
    const html = await page({ cookie: 'ar' }, mount);
    const a = amounts(html);
    expect(a.isolated.length).toBeGreaterThan(0);
    expect(a.bare).toBe(0);
    expect(a.isolated.filter((x) => !INDIAN.test(x))).toEqual([]);
    expect(main(html)).not.toMatch(/\d\s*₹/);
    expect(main(html)).not.toMatch(/‏-?\d[\d,]*\.\d{2}/);
  });

  it('the exact amounts: the home\'s outstanding past 2^53, and the loan book\'s per-loan figures', async () => {
    expect(amounts(await page({ cookie: 'ar' }, home)).isolated).toContain('₹9,00,71,99,25,47,409.93');   // 9007199254740993 paise, exact past 2^53
    const b = amounts(await page({ cookie: 'ar' }, book)).isolated;
    for (const x of BOOK_AMOUNTS) expect({ x, in: b.includes(x) }).toEqual({ x, in: true });
  });

  it.each(PAGES)('%s under en: the same amounts, en-IN, NO isolation marks, English copy', async (_n, mount, named) => {
    const html = await page({ cookie: 'en' }, mount);
    const body = main(html);
    expect(body).not.toMatch(/[⁦-⁩]/);
    expect(body).toMatch(/₹\d/);
    expect(ARABIC.test(html)).toBe(false);
    for (const k of named) expect({ k, en: html.includes(esc(en[k])) }).toEqual({ k, en: true });
  });
});

// ---- 4 · en / hi / gu byte-identical ------------------------------------------------------------------------------------------------------
// The whole rendered page with the RTL-1d helpers as built, and the same render with them swapped back to the b77c7f0f calls: `moneyText` → the
// bare `formatMoneyMinor(…, lang)`, `ltrText` → the text itself. Under en/hi/gu the two are identical to the byte; under ar they differ (so the
// comparison can see a change).
async function nowAndBefore(cookie: string, mount: () => Promise<React.ReactNode>): Promise<[string, string]> {
  jest.useFakeTimers({ now: new Date('2026-10-29T10:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
  try {
    const now = await page({ cookie }, mount);
    const m = jest.spyOn(moneyModule, 'moneyText').mockImplementation((x, c, l) => formatMoneyMinor(x, c, l));
    const s = jest.spyOn(spanModule, 'ltrText').mockImplementation((x) => x);
    try { return [now, await page({ cookie }, mount)]; } finally { m.mockRestore(); s.mockRestore(); }
  } finally { jest.useRealTimers(); }
}
describe('4 · under en / hi / gu every page is BYTE-IDENTICAL to the bare b77c7f0f calls', () => {
  it.each(PAGES)('%s', async (_n, mount) => {
    for (const cookie of ['en', 'hi', 'gu']) {
      const [now, before] = await nowAndBefore(cookie, mount);
      expect({ cookie, same: now === before }).toEqual({ cookie, same: true });
      expect(now).toMatch(/₹\d/);
    }
    const [arNow, arBefore] = await nowAndBefore('ar', mount);
    expect(arNow).not.toBe(arBefore);
    expect(arBefore).not.toContain(LRI);
  });
  it('hi is still Hindi (the dashboard title) with no banner', async () => {
    const html = await page({ cookie: 'hi' }, home);
    expect(html).toContain(esc(hi['partner1.dash.title']));
    expect(html).not.toContain('kv-md-banner');
  });
});

// ---- 5 · the language choice, and a code inside an Arabic sentence ------------------------------------------------------------------------
describe('5 · the language choice offers Arabic as a labelled machine draft; codes in Arabic sentences are isolated', () => {
  const view = (cookie: string) => { as({ cookie }); return renderToStaticMarkup(
    <AccountNotificationPrefsView t={getTranslator()} state="on" current={getLanguageDef()} choices={LANGUAGE_CHOICES} previews={PREVIEW_CHOICES} />); };
  it('under en: the live radios as before, then Arabic named in Arabic with "(machine draft)", not checked', () => {
    const html = view('en');
    expect(html).toContain('<label class="kv-lang-choice__option kv-lang-choice__option--draft" data-kv-lang-option="ar" data-kv-lang-draft="true"><input type="radio" name="lang" value="ar"/><span><bdi lang="ar" dir="rtl">العربية</bdi> <span class="kv-lang-choice__draft">(machine draft)</span></span></label>');
    expect((html.match(/type="radio"/g) ?? []).length).toBe(LANGUAGE_CHOICES.length + 1);
  });
  it('under ar: Arabic is the checked option, its tag in Arabic', () => {
    const html = view('ar');
    expect(html).toContain('<input type="radio" name="lang" checked="" value="ar"/><span><bdi lang="ar" dir="rtl">العربية</bdi> <span class="kv-lang-choice__draft">(مسودة آلية)</span>');
  });
  it('the review state names Arabic as a machine draft and posts to the PREVIEW act; a live choice keeps the live act and no tag', () => {
    as({ cookie: 'en' });
    const live = jest.fn(); const preview = jest.fn();
    const r = (chosen: (typeof PREVIEW_CHOICES)[number]) => renderToStaticMarkup(<AccountChain6 t={getTranslator()} chain="notification_form" state="review" chosen={chosen} act={live as never} previewAct={preview as never} />);
    const a = r(PREVIEW_CHOICES[0]);
    expect(a).toContain('data-kv-lang-draft="true">(machine draft)</span>');
    const b = r(LANGUAGE_CHOICES[1]);
    expect(b).not.toContain('data-kv-lang-draft');
    expect(b).not.toContain('machine draft');
  });
  it('the verify step\'s masked phone inside the Arabic sentence is one isolated run; under en the sentence is unchanged', () => {
    as({ cookie: 'ar' });
    const actions = { requestOtp: '/a', verifyOtp: '/b', choosePartner: '/c', verify2fa: '/d' } as never;
    const html = renderToStaticMarkup(<LoginSteps t={getTranslator()} lang="ar" step="verify" phoneMasked="••••••318" actions={actions} />);
    expect(html).toContain(esc(ar['partner.login.verifyLead'].replace('{phone}', `${LRI}••••••318${PDI}`)));
    as({ cookie: 'en' });
    const e = renderToStaticMarkup(<LoginSteps t={getTranslator()} step="verify" phoneMasked="••••••318" actions={actions} />);
    expect(e).toContain(esc(en['partner.login.verifyLead'].replace('{phone}', '••••••318')));
    expect(e).not.toMatch(/[⁦-⁩]/);
  });
});
