// apps/web-storefront/src/test-render/store-footer.render.test.tsx · PC-56 STORE-SWEEP-a · C3 (founders D3 / D4; survey F-5 / F-10) — THE STORE STAYS
// THE STORE, AND TRUST IS THE PLATFORM'S.
//   • a store's footer (the REAL layout): Help, the quality promise and Contact under `/<slug>` (mutant M2 — the help link back to `/help` → red);
//     "Grievances" → the PLATFORM's trust page (`/trust-data#grievances` on a path store; the platform origin on the store's own host); "Powered by"
//     a LINK to the platform's `/about` the same way — and Grievances stays even when the mark is hidden (a trust surface);
//   • the platform footer: the "coming soon · STORE-5" lines are retired — links to /quality-promise, /contact, /trust-data;
//   • the listing page's "learn about traceability" stays in the store (its own help).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const SITE = { url: '' };
jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./store6a-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, usePathname: () => '/', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: () => undefined }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', get siteUrl() { return SITE.url; }, platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../app/(platform)/login/actions', () => ({ logoutAction: async () => undefined }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./store6a-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient, sessionTenantClient: () => f.publicClient() }; });
jest.mock('../lib/storefront-data', () => { const f = jest.requireActual('./store6a-fixtures'); return { loadTenantShell: f.loadTenantShell }; });
jest.mock('../components/OnlineGuard', () => ({ OnlineGuard: () => null }));
jest.mock('../components/offline/SignalReasons', () => ({ SignalReasons: () => null }));
jest.mock('../components/offline/UpdateNotice', () => ({ UpdateNotice: () => null }));
import { PLATFORM_BRAND } from '@krishalaya/tokens';
import PlatformLayout from '../app/(platform)/layout';
import TenantLayout from '../app/[tenantSlug]/layout';
import { SiteHeader } from '../components/SiteHeader';
import { TenantHeader } from '../components/TenantHeader';
import { TenantFooter } from '../components/TenantFooter';
import { en } from '../i18n/en';
import { renderResolved, text } from './store1b-harness';
import { C, SLUG, brandWith, reset } from './store6a-fixtures';

beforeEach(() => { reset(); SITE.url = ''; });
const footerOf = (h: string) => h.slice(h.indexOf('<footer'), h.indexOf('</footer>') + 9);
const storeFooter = async () => footerOf(await renderResolved(await TenantLayout({ children: <p>page</p>, params: { tenantSlug: SLUG } }), [TenantHeader]));

describe('STORE-SWEEP-a · the store\'s footer (the real layout)', () => {
  it('a PATH store: Help, the quality promise, Contact under /<slug>; Grievances and "Powered by" on the same origin', async () => {
    const f = await storeFooter();
    expect(f).toContain('data-kv-footer="tenant"');
    expect(f).toContain(`href="/${SLUG}/help"`);
    expect(f).toContain(`href="/${SLUG}/quality-promise"`);
    expect(f).toContain(`href="/${SLUG}/contact"`);
    expect(f).toContain('href="/trust-data#grievances"');
    expect(f).toMatch(new RegExp(`<a href="/about"[^>]*data-kv-link="platform-about"><small>${PLATFORM_BRAND.poweredByMark}</small></a>`));
    expect(f).not.toMatch(/href="\/(help|quality-promise|contact)"/);   // never the platform's own help / promise / contact
    expect(text(f)).toContain(en['sweep.footer.grievances']);
  });
  it('the store\'s OWN host: Grievances and "Powered by" point at the PLATFORM origin; the store\'s pages stay the store\'s', async () => {
    SITE.url = 'https://bazaar.example.test';
    C.headers = { 'x-kv-tenant-slug': SLUG };          // host-routed by the middleware
    const f = await storeFooter();
    expect(f).toContain('href="https://bazaar.example.test/trust-data#grievances"');
    expect(f).toContain('href="https://bazaar.example.test/about"');
    expect(f).toContain(`href="/${SLUG}/help"`);
  });
  it('the mark hidden (white-label): no "Powered by" — Grievances STAYS (a trust surface is never hidden)', async () => {
    C.branding = brandWith({ poweredByHidden: true });
    const f = await storeFooter();
    expect(f).not.toContain(PLATFORM_BRAND.poweredByMark);
    expect(f).toContain('href="/trust-data#grievances"');
  });
  it('the component alone: no platform name in the store footer\'s own words', () => {
    const f = renderToStaticMarkup(<TenantFooter name="Anand FPO" slug={SLUG} showPoweredBy={false} />);
    expect(text(f)).not.toContain(PLATFORM_BRAND.name);
  });
});

describe('STORE-SWEEP-a · the platform footer', () => {
  it('the "coming soon" lines are retired: the quality promise, Contact and Trust & your data are links', async () => {
    const h = await renderResolved(PlatformLayout({ children: <p>page</p> }), [SiteHeader]);
    const f = footerOf(h);
    expect(f).not.toContain('data-kv-soon');
    expect(f).not.toContain(en['footer.returns'] + ' · ');
    for (const href of ['/help', '/quality-promise', '/contact', '/trust-data']) expect(f).toContain(`href="${href}"`);
  });
});
