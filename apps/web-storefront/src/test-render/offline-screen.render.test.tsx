// apps/web-storefront/src/test-render/offline-screen.render.test.tsx · PC-56 STORE-6a · C3 (canon W313, founders D2 / D6 / D7) — THE OFFLINE PAGE,
// UNDER BOTH CHROMES. Rendered through the REAL layouts as Next calls them (`(shell)/layout.tsx` + `(shell)/offline/page.tsx`; the organisation's
// `[tenantSlug]/layout.tsx` in its shell mode — the middleware's `x-kv-shell: offline` — + `[tenantSlug]/offline/page.tsx`) with the REAL lib/i18n
// and lib/auth over a recorded cookie jar, and an API stand-in that WOULD answer a signed-in person's header (3 cart lines):
//   • the organisation's page names the ORGANISATION (its published name, from the public brand read) and never the platform's store name;
//     "Powered by" only under the 13d rule; no session-derived string, no session cookie READ, no cart call — with a session cookie present;
//   • the platform's page makes no API call at all (HOTFIX-8's law) and prints the platform's sentence about kept pages;
//   • the rules: the three rows (with signal / without / a slow connection — no slow tier), the four tiers, the money word, the three don'ts,
//     the in-context example ("Add to cart — needs signal"; nothing saved), the pages never kept (payment, a live auction, an offer's
//     accept / counter), the links to /queued and /app under THIS chrome, every W313 refusal by name;
//   • what this organisation keeps: its `storefront_offline_reads` ON → the bounded sentence; OFF or unreadable → "does not keep pages";
//   • the retired `offline.hint` (the platform's mobile-app plug) is nowhere.
import * as React from 'react';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./store6a-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, usePathname: () => '/offline', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: () => undefined }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../app/(platform)/login/actions', () => ({ logoutAction: async () => undefined }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./store6a-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient, sessionTenantClient: () => f.publicClient() }; });
jest.mock('../lib/storefront-data', () => { const f = jest.requireActual('./store6a-fixtures'); return { loadTenantShell: f.loadTenantShell }; });

import { PLATFORM_BRAND } from '@krishalaya/tokens';
import ShellLayout from '../app/(shell)/layout';
import ShellOfflinePage from '../app/(shell)/offline/page';
import TenantLayout from '../app/[tenantSlug]/layout';
import TenantOfflinePage from '../app/[tenantSlug]/offline/page';
import { TenantHeader } from '../components/TenantHeader';
import { SiteHeader } from '../components/SiteHeader';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { store6RefusalKeys } from '../features/store6/refusals';
import { renderResolved, text } from './store1b-harness';
import { C, ORG, SESSION, SLUG, brandWith, reset, withCookies } from './store6a-fixtures';

const platform = async (cookies: Record<string, string> = {}, sp: Record<string, string> = {}) => {
  withCookies(cookies); C.api = [];
  return renderResolved(ShellLayout({ children: <ShellOfflinePage searchParams={sp} /> }), [SiteHeader]);
};
const store = async (cookies: Record<string, string> = {}, sp: Record<string, string> = {}) => {
  withCookies(cookies); C.api = []; C.headers = { 'x-kv-shell': 'offline' };
  const page = await TenantOfflinePage({ params: { tenantSlug: SLUG }, searchParams: sp });
  return renderResolved(await TenantLayout({ children: page, params: { tenantSlug: SLUG } }), [TenantHeader]);
};
const SESSION_WORDS = [en['nav.account'], en['nav.notifications'], en['nav.logout'], en['nav.offers'], en['nav.messages'], en['nav.cart'], en['nav.orders']];
beforeEach(() => reset());

describe('STORE-6a · W313 · the organisation\'s offline page (its shell chrome)', () => {
  it.each([['without a session cookie', {}], ['WITH a session cookie (kv_session + kv_refresh + kv_tid + the owner marker)', SESSION]])(
    'names the organisation, never the platform store; no session string, no session cookie read, no cart call — %s', async (_l, cookies) => {
      const h = await store(cookies as Record<string, string>);
      const words = text(h);
      expect(h).toContain(`<span data-kv-mark="tenant">${ORG}</span>`);
      expect(h).toContain('data-kv-shell="offline"');
      expect(words).toContain(en['store6.offline.keep.on'].replace('{org}', ORG).replace('{pages}', '20').replace('{days}', '7'));
      expect(words).not.toContain(PLATFORM_BRAND.platformStoreName);
      for (const w of SESSION_WORDS) expect([w, words.includes(w)]).toEqual([w, false]);
      expect(h).not.toMatch(/\/cart"|\/account"|\/orders"|\/messages"|\/notifications"|data-kv-nav=|kv-header__badge/);
      expect(h).not.toMatch(/<form/);                                                   // no search form, no sign-out form
      for (const v of Object.values(SESSION)) expect(h).not.toContain(v);
      expect(C.read.filter((n) => n !== 'kv_lang')).toEqual([]);                        // only the device's language preference
      // the public brand read (React-cached once per request in the app; this stand-in is not) + the public flags read — no cart, no session
      expect([...new Set(C.api.map((c) => c[0]))].sort()).toEqual(['flags', 'shell']);
      expect(C.api).toContainEqual(['flags', SLUG]);
      expect(h).toContain(`href="/${SLUG}" class="kv-btn" data-kv-retry=""`);          // Try again → the store's home (the script points it at the URL)
      expect(h).toContain('!/\\/offline$/.test(location.pathname)');
    });

  it('"Powered by" follows the 13d rule (shown; gone when the organisation hides it with its plan)', async () => {
    expect(await store()).toContain('data-kv-mark="platform"');
    C.branding = brandWith({ poweredByHidden: true });
    expect(await store()).not.toContain('data-kv-mark="platform"');
  });

  it('what the organisation keeps: ON → the bounded sentence; OFF → "does not keep pages"; an unreadable flag → OFF (fail closed)', async () => {
    let h = await store();
    expect(h).toContain('data-kv-keep="on"');
    C.flags = { storefront_offline_reads: false };
    h = await store();
    expect(h).toContain('data-kv-keep="off"');
    expect(text(h)).toContain(en['store6.offline.keep.off'].replace('{org}', ORG));
    C.flags = new Error('flags down');
    expect(await store()).toContain('data-kv-keep="off"');
  });

  it('the rules: three rows (no slow tier), four tiers + the money word, three don\'ts, the example, the pages never kept, the links under THIS chrome', async () => {
    const h = await store(); const words = text(h);
    for (const r of ['online', 'offline', 'slow']) expect(h).toContain(`data-kv-state-row="${r}"`);
    for (const t of ['fresh', 'aging', 'prominent', 'full', 'money']) expect(h).toContain(`data-kv-tier="${t}"`);
    expect(words).toContain(en['store6.offline.tier.full'].replace('{hours}', '24').replace(/"/g, '"'));
    for (const d of ['stale-without-band', 'blank', 'auto-refresh']) expect(h).toContain(`data-kv-dont="${d}"`);
    expect(words).toContain(en['store6.offline.example.addToCart']); expect(words).toContain(en['store6.offline.example.nothingSaved']);
    for (const n of ['payment', 'auction', 'offer']) expect(h).toContain(`data-kv-never-kept="${n}"`);
    expect(h).toContain(`href="/${SLUG}/queued"`); expect(h).toContain(`href="/${SLUG}/app"`); expect(h).toContain(`href="/${SLUG}/offline?form=review"`);
    for (const k of store6RefusalKeys('offline')) expect([k, words.includes(en[k])]).toEqual([k, true]);
    expect(store6RefusalKeys('offline').length).toBe(5);
  });

  it('in Hindi and Gujarati: the organisation\'s page speaks the device language; still no session cookie read', async () => {
    for (const [code, cat] of [['hi', hi], ['gu', gu]] as const) {
      const h = await store({ ...SESSION, kv_lang: code });
      expect(text(h)).toContain(cat['store6.offline.states.title']);
      expect(text(h)).toContain(cat['offline.heading']);
      expect(C.read.filter((n) => n !== 'kv_lang')).toEqual([]);
    }
  });
});

describe('STORE-6a · W313 · the platform\'s offline page (the session-free shell)', () => {
  it('the same rules; NO API call (HOTFIX-8\'s law); the platform\'s sentence about kept pages; links under the platform chrome', async () => {
    const h = await platform(SESSION); const words = text(h);
    expect(C.api).toEqual([]);
    expect(h).toContain('data-kv-keep="platform"');
    expect(words).toContain(en['store6.offline.keep.platform'].replace('{pages}', '20').replace('{days}', '7'));
    expect(h).toContain('href="/queued"'); expect(h).toContain('href="/app"');
    expect(h).toContain('href="/" class="kv-btn" data-kv-retry=""');
    for (const k of store6RefusalKeys('offline')) expect([k, words.includes(en[k])]).toEqual([k, true]);
    expect(C.read.filter((n) => n !== 'kv_lang')).toEqual([]);
  });
  it('the retired mobile-app sentence is nowhere (founder D7)', async () => {
    const h = await platform();
    expect(text(h)).not.toMatch(/mobile app|offline-first/i);
    expect('offline.hint' in en).toBe(false);
  });
});
