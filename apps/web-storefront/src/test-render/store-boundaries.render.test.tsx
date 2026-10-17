// apps/web-storefront/src/test-render/store-boundaries.render.test.tsx · PC-56 STORE-SWEEP-b · C3 (founder D4, survey F-7 / B12 / E3 — canon W316) — EVERY
// ERROR INSIDE ITS OWN STORE. Next 14's nearest-boundary rule puts `[tenantSlug]/not-found.tsx` and `[tenantSlug]/error.tsx` INSIDE `[tenantSlug]/layout.tsx`;
// here the REAL layout is rendered around them (as Next does):
//   • a store's 404: the organisation's header and footer, its name, the three questions, "Back to <organisation>" → `/<slug>` (mutant M2 — the file
//     renamed away — turns this red);
//   • a store's error: the same chrome, "our side", nothing charged or lost, a Try-again BUTTON and NO timer or effect (no automatic retry), your
//     orders, the digest in small print; the button calls reset() only when pressed;
//   • the platform's 404 / error inside the platform's chrome: "Back to the bazaar" → `/`;
//   • `global-error`: its own <html lang dir>, no chrome at all (no header, no footer, no brand), the three questions;
//   • no "Oops", no exclamation mark; in Hindi and Gujarati too.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./store6a-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, usePathname: () => '/', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: () => undefined }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../app/(platform)/login/actions', () => ({ logoutAction: async () => undefined }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./store6a-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient, sessionTenantClient: () => f.publicClient() }; });
jest.mock('../lib/storefront-data', () => { const f = jest.requireActual('./store6a-fixtures'); return { loadTenantShell: f.loadTenantShell }; });
jest.mock('../components/OnlineGuard', () => ({ OnlineGuard: () => null }));
jest.mock('../components/offline/SignalReasons', () => ({ SignalReasons: () => null }));
jest.mock('../components/offline/UpdateNotice', () => ({ UpdateNotice: () => null }));
import { PLATFORM_BRAND } from '@krishalaya/tokens';
import PlatformLayout from '../app/(platform)/layout';
import TenantLayout from '../app/[tenantSlug]/layout';
import TenantNotFound from '../app/[tenantSlug]/not-found';
import TenantError from '../app/[tenantSlug]/error';
import PlatformNotFound from '../app/(platform)/not-found';
import PlatformError from '../app/(platform)/error';
import RootNotFound from '../app/not-found';
import GlobalError from '../app/global-error';
import { SiteHeader } from '../components/SiteHeader';
import { TenantHeader } from '../components/TenantHeader';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { renderResolved, text } from './store1b-harness';
import { ORG, SLUG, reset, withCookies } from './store6a-fixtures';

const inStore = async (child: React.ReactNode) => renderResolved(await TenantLayout({ children: child, params: { tenantSlug: SLUG } }), [TenantHeader]);
const onPlatform = async (child: React.ReactNode) => renderResolved(await PlatformLayout({ children: child }), [SiteHeader]);
const boundary = (h: string) => h.slice(h.indexOf('<section class="kv-empty-state"'), h.indexOf('</section>', h.indexOf('data-kv-boundary=')) + 10);
const err = Object.assign(new Error('boom'), { digest: '4182937' });
beforeEach(() => reset());

describe('STORE-SWEEP-b · a store\'s 404 stays in the store (the real layout)', () => {
  it('the organisation\'s header and footer, its name, the three questions, "Back to <organisation>" → /<slug>', async () => {
    const h = await inStore(<TenantNotFound />); const b = boundary(h); const w = text(b);
    expect(h).toContain('data-kv-footer="tenant"');
    expect(text(h)).toContain(ORG);
    expect(b).not.toContain(PLATFORM_BRAND.platformStoreName);   // (the header's breadcrumb back to the platform store is the 1b chrome — the boundary names the organisation)
    expect(b).toContain('data-kv-boundary="not_found"');
    expect(b).toContain('data-kv-boundary-chrome="store"');
    for (const k of ['sweep.err.notFound.title', 'sweep.err.notFound.what', 'sweep.err.notFound.safe'] as const) expect(w).toContain(en[k]);
    expect(w).toContain(`Go back to ${ORG} and find it from there.`);
    expect(b).toMatch(new RegExp(`<a href="/${SLUG}"[^>]*data-kv-link="back">Back to ${ORG}</a>`));
    expect(b).toContain('<small data-kv-code="support">For support: 404</small>');
    expect(b).not.toMatch(/href="\/"/);
  });
  it.each([['hi', hi], ['gu', gu]] as const)('%s: the same page in that language', async (l, cat) => {
    withCookies({ kv_lang: l });
    const w = text(boundary(await inStore(<TenantNotFound />)));
    expect(w).toContain(cat['sweep.err.notFound.title']);
    expect(w).toContain(cat['sweep.err.backStore'].replace('{org}', ORG));
  });
});

describe('STORE-SWEEP-b · a store\'s error stays in the store — a button, never a timer', () => {
  it('the chrome; our side; nothing charged or lost; Try again (a button), your orders, back to the organisation; the digest in small print', async () => {
    const reset0 = jest.fn();
    const h = await inStore(<TenantError error={err} reset={reset0} />); const b = boundary(h); const w = text(b);
    expect(h).toContain('data-kv-footer="tenant"');
    expect(b).toContain('data-kv-boundary="error"');
    expect(b).toContain('role="alert"');
    for (const k of ['sweep.err.error.title', 'sweep.err.error.what', 'sweep.err.error.safe', 'sweep.err.error.now'] as const) expect(w).toContain(en[k]);
    expect(b).toMatch(/<button type="button" class="kv-btn" data-kv-retry="button">Try again<\/button>/);
    expect(b).toContain(`href="/${SLUG}/orders"`);
    expect(b).toContain(`href="/${SLUG}"`);
    expect(b).toContain('For support: 4182937');
    expect(reset0).not.toHaveBeenCalled();                      // rendering never retries
  });
  it('the button is the only way to retry: pressing it calls reset() once', async () => {
    const reset0 = jest.fn();
    const el = TenantError({ error: err, reset: reset0 }) as React.ReactElement<{ onRetry: () => void }>;
    el.props.onRetry();
    expect(reset0).toHaveBeenCalledTimes(1);
  });
});

describe('STORE-SWEEP-b · the platform\'s boundaries, the root 404 and global-error', () => {
  it('(platform)/not-found: inside the platform chrome, "Back to the bazaar" → /', async () => {
    const h = await onPlatform(<PlatformNotFound />); const b = boundary(h);
    expect(h).toContain(PLATFORM_BRAND.platformStoreName);       // the platform's own header
    expect(b).toContain('data-kv-boundary-chrome="platform"');
    expect(b).toMatch(/<a href="\/"[^>]*data-kv-link="back">Back to the bazaar<\/a>/);
    expect(text(b)).toContain(en['sweep.err.notFound.nowPlatform']);
  });
  it('(platform)/error: inside the platform chrome, a button, /orders, back to the bazaar', async () => {
    const b = boundary(await onPlatform(<PlatformError error={err} reset={() => undefined} />));
    expect(b).toContain('data-kv-retry="button"');
    expect(b).toContain('href="/orders"');
    expect(b).toContain('Back to the bazaar');
  });
  it('the root 404 (an unknown organisation\'s /<slug>): its own landmark, the platform\'s words', () => {
    const h = renderToStaticMarkup(<RootNotFound />);
    expect(h).toContain('<main class="kv-container" id="main">');
    expect(h).toContain('data-kv-boundary-chrome="platform"');
  });
  it('global-error: its own <html lang dir>, no chrome, the three questions', () => {
    const h = renderToStaticMarkup(<GlobalError error={err} reset={() => undefined} />);
    expect(h.startsWith('<html lang="en" dir="ltr">')).toBe(true);
    expect(h).not.toMatch(/<header|<footer|kv-header|kv-footer/);
    expect(h).not.toContain(PLATFORM_BRAND.platformStoreName);
    for (const k of ['sweep.err.error.what', 'sweep.err.error.safe', 'sweep.err.error.now'] as const) expect(text(h)).toContain(en[k]);
    expect(h).toContain('data-kv-retry="button"');
  });
  it('no "Oops" and no exclamation mark in any boundary, in any language', async () => {
    for (const l of ['en', 'hi', 'gu']) {
      reset(); withCookies({ kv_lang: l });
      for (const h of [await inStore(<TenantNotFound />), await inStore(<TenantError error={err} reset={() => undefined} />), await onPlatform(<PlatformNotFound />)]) {
        expect(text(boundary(h))).not.toMatch(/Oops|!/i);
      }
    }
  });
});
