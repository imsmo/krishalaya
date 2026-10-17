// apps/web-storefront/src/test-render/drafts-chip.render.test.tsx · PC-56 STORE-6b · B8 / C2 — "N ON THIS PHONE", beside the cart in BOTH headers:
//   • SiteHeader → `/sync` (every store's drafts on this host: slug null); TenantHeader → `/<slug>/sync` (THIS organisation's only);
//   • NEVER in the offline shell (TenantShellHeader / the `(shell)` layout — session-free, the same for every person);
//   • the server's HTML never carries a count (the island renders nothing until the phone answers; nothing at 0) — a kept public page stays
//     the same for everyone; the view says "N on this phone" with the count in its accessible name.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./store6a-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, usePathname: () => '/', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: () => undefined }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../app/(platform)/login/actions', () => ({ logoutAction: async () => undefined }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./store6a-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient, sessionTenantClient: () => f.publicClient() }; });
jest.mock('../lib/storefront-data', () => { const f = jest.requireActual('./store6a-fixtures'); return { loadTenantShell: f.loadTenantShell }; });
jest.mock('../components/drafts/DraftsChip', () => {
  const actual = jest.requireActual('../components/drafts/DraftsChip');
  return { ...actual, DraftsChip: (p: { slug: string | null; href: string; labels: { chip: string } }) => <i data-kv-chip-mounted={p.slug ?? 'all'} data-kv-chip-href={p.href} data-kv-chip-label={p.labels.chip} /> };
});

import TenantLayout from '../app/[tenantSlug]/layout';
import { SiteHeader } from '../components/SiteHeader';
import { TenantHeader } from '../components/TenantHeader';
import { TenantShellHeader } from '../components/offline/TenantShellHeader';
import { en } from '../i18n/en';
import { renderResolved, text } from './store1b-harness';
import { C, SESSION, SLUG, ORG, reset, withCookies } from './store6a-fixtures';

const { DraftsChip: RealChip, DraftsChipView } = jest.requireActual('../components/drafts/DraftsChip') as typeof import('../components/drafts/DraftsChip');
beforeEach(() => reset());
const count = (h: string, re: RegExp) => (h.match(re) ?? []).length;
const L = { chip: en['store6b.chip'], aria: en['store6b.chip.aria'] };

describe('STORE-6b · the chip in both headers, beside the cart', () => {
  it('the platform header: once, every store on this host (slug null) → /sync, just before the cart', async () => {
    withCookies(SESSION);
    const h = await renderResolved(<SiteHeader />, [SiteHeader]);
    expect(count(h, /data-kv-chip-mounted=/g)).toBe(1);
    expect(h).toContain('data-kv-chip-mounted="all"'); expect(h).toContain('data-kv-chip-href="/sync"');
    expect(h).toContain('data-kv-chip-label="{n} on this phone"');
    expect(h.indexOf('data-kv-chip-mounted')).toBeLessThan(h.indexOf('href="/cart"'));
  });
  it('the organisation\'s header: once, THIS organisation → /<slug>/sync, beside its cart — signed in or not', async () => {
    for (const jar of [{}, SESSION]) {
      withCookies(jar);
      const h = await renderResolved(<TenantHeader slug={SLUG} name={ORG} logoSrc={null} showPoweredBy />, [TenantHeader]);
      expect(count(h, /data-kv-chip-mounted=/g)).toBe(1);
      expect(h).toContain(`data-kv-chip-mounted="${SLUG}"`); expect(h).toContain(`data-kv-chip-href="/${SLUG}/sync"`);
      expect(h.indexOf('data-kv-chip-mounted')).toBeLessThan(h.indexOf(`href="/${SLUG}/cart"`));
    }
  });
  it('NEVER in the offline shell: TenantShellHeader, and the organisation\'s layout in shell mode', async () => {
    expect(renderToStaticMarkup(<TenantShellHeader slug={SLUG} name={ORG} logoSrc={null} showPoweredBy />)).not.toContain('data-kv-chip');
    C.headers = { 'x-kv-shell': 'offline' };
    expect(renderToStaticMarkup(await TenantLayout({ children: <p>offline</p>, params: { tenantSlug: SLUG } }))).not.toContain('data-kv-chip');
  });
});

describe('STORE-6b · the chip itself — no count in the server\'s HTML', () => {
  it('the island\'s server render is EMPTY (the phone answers later; a kept page is the same for everyone)', () => {
    expect(renderToStaticMarkup(<RealChip slug={SLUG} href={`/${SLUG}/sync`} labels={L} lang="en" />)).toBe('');
    expect(renderToStaticMarkup(<RealChip slug={null} href="/sync" labels={L} lang="hi" />)).toBe('');
  });
  it('the view: nothing at 0 or before the phone answers; "N on this phone" → the list, the count in the accessible name', () => {
    expect(renderToStaticMarkup(<DraftsChipView n={null} href="/sync" labels={L} />)).toBe('');
    expect(renderToStaticMarkup(<DraftsChipView n={0} href="/sync" labels={L} />)).toBe('');
    const h = renderToStaticMarkup(<DraftsChipView n={2} href={`/${SLUG}/sync`} labels={L} />);
    expect(text(h).trim()).toBe('2 on this phone');
    expect(h).toContain(`href="/${SLUG}/sync"`); expect(h).toContain('aria-label="Unsent drafts on this phone: 2"'); expect(h).toContain('data-kv-nav="drafts"');
    expect(text(renderToStaticMarkup(<DraftsChipView n={3} href="/sync" labels={L} fmt={(n) => new Intl.NumberFormat('hi-IN-u-nu-deva').format(n)} />))).toContain('३');
  });
});
