// apps/web-storefront/src/test-render/offline-shell.render.test.tsx · PC-56 HOTFIX-8 · D1 (a) — THE OFFLINE SHELL IS SESSION-FREE.
// The service worker pre-caches `/offline` with the page's cookies, so its HTML is what stays on a shared phone. Rendered here through its
// REAL layout chain below the root — `app/(shell)/layout.tsx` + `app/(shell)/offline/page.tsx` — with the REAL lib/i18n, lib/auth and cart
// summary over a mocked cookie jar, and an API stand-in that WOULD answer a signed-in person's header (3 cart lines, the session store
// `anand-fpo`, messages + offers ON). Proves, with and without a session cookie:
//   • no "Account", no "Notifications", no "Sign out", no cart count / cart link, no `/<slug>/messages`, no slug, no cookie-derived string;
//   • no session cookie is even READ (the jar records every name asked for — only the device's language preference `kv_lang`);
//   • nothing is fetched (no API call at all);
//   • the platform's name from packages/tokens, the shell's keyed label (en / hi / gu), noindex;
//   • "Try again": `/` in the HTML and a one-line script that points it at the requested URL (`location.href`) when the shell stands in.
// Mutant M1 (the shell rendered inside the platform layout again) turns this red.
import * as React from 'react';

type Jar = Map<string, string>;
const S: { jar: Jar; read: string[]; api: string[] } = { jar: new Map(), read: [], api: [] };
const SESSION = { kv_session: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwMTkwYThiMi0wMDAwLTcwMDAtODAwMC0wMDAwMDAwMDAwMGEifQ.sig', kv_refresh: 'refresh-token-hf8', kv_tid: '0190a8b2-0000-7000-8000-0000000000aa', kvs_owner: 'AAAAAAAAAAAAAAAAAAAAAA' };

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => ({
  cookies: () => ({
    get: (n: string) => { S.read.push(n); return S.jar.has(n) ? { name: n, value: S.jar.get(n) } : undefined; },
    has: (n: string) => { S.read.push(n); return S.jar.has(n); },
    getAll: () => { S.read.push('*'); return [...S.jar].map(([name, value]) => ({ name, value })); },
    set: () => undefined, delete: () => undefined,
  }),
  headers: () => new Headers({ 'accept-language': 'en' }),
}));
jest.mock('next/navigation', () => ({ usePathname: () => '/offline', useSearchParams: () => new URLSearchParams(), redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../app/(platform)/login/actions', () => ({ logoutAction: async () => undefined }));
// A signed-in person's header, if anything asked: 3 cart lines, the session store `anand-fpo`, offers + messages ON.
jest.mock('../lib/api-client', () => {
  const rec = (what: string) => { S.api.push(what); };
  return {
    publicClient: () => ({ lookups: { categories: async () => { rec('categories'); return []; } } }),
    serverClient: () => ({ cart: { get: async () => { rec('cart'); return { items: [{}, {}, {}] }; } } }),
    sessionTenantClient: () => ({ storefront: {
      flags: async () => { rec('flags'); return { offers: true, auctions: true, communication: true }; },
      tenant: async () => { rec('tenant'); return { slug: 'anand-fpo' }; },
    } }),
  };
});

import { PLATFORM_BRAND } from '@krishalaya/tokens';
import ShellLayout from '../app/(shell)/layout';
import OfflinePage, { generateMetadata } from '../app/(shell)/offline/page';
import { SiteHeader } from '../components/SiteHeader';
import { SiteFooter } from '../components/SiteFooter';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { renderResolved, text } from './store1b-harness';

const render = (cookies: Record<string, string>) => {
  S.jar = new Map(Object.entries(cookies)); S.read = []; S.api = [];
  // the platform chrome's async components are named so that IF the shell ever renders them again (M1), they are resolved and their
  // markup judged by the assertions below — never a render crash standing in for the proof
  return renderResolved(ShellLayout({ children: <OfflinePage /> }), [SiteHeader, SiteFooter]);   // the layout CALLED, as Next does
};
const SESSION_WORDS = [en['nav.account'], en['nav.notifications'], en['nav.logout'], en['nav.offers'], en['nav.messages'], en['nav.cart']];

describe('HOTFIX-8 · D1 (a) · the offline shell renders session-free', () => {
  it.each([['without a session cookie', {}], ['WITH a session cookie (kv_session + kv_refresh + kv_tid + the owner marker)', SESSION]])(
    'no session-derived string, no session cookie read, no API call — %s', async (_label, cookies) => {
      const h = await render(cookies as Record<string, string>);
      const words = text(h);
      for (const w of SESSION_WORDS) expect(words).not.toContain(w);
      expect(h).not.toMatch(/href="\/cart"|href="\/account"|href="\/notifications"|href="\/offers"|\/messages"|anand-fpo|kv-header__badge|data-kv-nav=/);
      expect(h).not.toContain(SESSION.kv_session); expect(h).not.toContain(SESSION.kv_tid); expect(h).not.toContain(SESSION.kvs_owner);
      expect(h).not.toMatch(/<form/);                                                         // no sign-out form, no search form
      expect(S.read.filter((n) => n !== 'kv_lang')).toEqual([]);                             // only the device's language preference
      expect(S.api).toEqual([]);                                                              // nothing fetched
      // the shell's own chrome: the platform's name from tokens, the keyed label, the offline words, Try again
      expect(h).toContain('data-kv-shell="offline"');
      expect(h).toContain(`<span data-kv-mark="platform-store">${PLATFORM_BRAND.platformStoreName}</span>`);
      expect(h).toContain(`aria-label="${en['offline.shell.home'].replace('{store}', PLATFORM_BRAND.platformStoreName)}"`);
      expect(words).toContain(en['offline.heading']); expect(words).toContain(en['offline.retry']);
      expect(h).toContain('id="main"');
    });

  it('"Try again" is `/` in the HTML and the script points it at the requested URL when the shell stands in for another page', async () => {
    const h = await render(SESSION);
    expect(h).toMatch(/<a href="\/" class="kv-btn" data-kv-retry="">/);
    expect(h).toContain("location.pathname!=='/offline'");
    expect(h).toContain("a.setAttribute('href',location.href)");
  });

  it('the shell speaks the device language (en / hi / gu) — the label and the offline words; noindex', async () => {
    for (const [code, cat] of [['hi', hi], ['gu', gu]] as const) {
      const h = await render({ ...SESSION, kv_lang: code });
      expect(h).toContain(`aria-label="${cat['offline.shell.home'].replace('{store}', PLATFORM_BRAND.platformStoreName)}"`);
      expect(text(h)).toContain(cat['offline.heading']);
      expect(S.read.filter((n) => n !== 'kv_lang')).toEqual([]);
    }
    S.jar = new Map(); expect(generateMetadata()).toMatchObject({ title: en['offline.title'], robots: { index: false, follow: false } });
  });
});
