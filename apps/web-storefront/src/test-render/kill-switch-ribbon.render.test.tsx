// apps/web-storefront/src/test-render/kill-switch-ribbon.render.test.tsx · PC-56 STORE-SWEEP-b · C3 (founder D2 — canon W320; no status page, B9 queued)
// — THE RIBBON, through BOTH REAL LAYOUTS: while the platform's `storefront_cart` or `storefront_browse` kill-switch is OFF, every page of the chrome
// names the feature, says "our side" (buying: "nothing was charged") and gives the working detour (browsing lots works / your orders stay readable);
// no time promise; absent when both are ON or the flags cannot be read (both switches fail open). The kill-switch pages themselves (BrowseOff /
// CartOff) say "our side" and, for buying, "nothing was charged".
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./store6a-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, usePathname: () => '/', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: () => undefined }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../app/(platform)/login/actions', () => ({ logoutAction: async () => undefined }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./store6a-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient, sessionTenantClient: () => f.publicClient() }; });
jest.mock('../lib/storefront-data', () => { const f = jest.requireActual('./store6a-fixtures'); return { loadTenantShell: f.loadTenantShell }; });
jest.mock('../components/OnlineGuard', () => ({ OnlineGuard: () => <div data-kv-test="online-guard" /> }));
jest.mock('../components/offline/SignalReasons', () => ({ SignalReasons: () => null }));
jest.mock('../components/offline/UpdateNotice', () => ({ UpdateNotice: () => null }));
import PlatformLayout from '../app/(platform)/layout';
import TenantLayout from '../app/[tenantSlug]/layout';
import { SiteHeader } from '../components/SiteHeader';
import { TenantHeader } from '../components/TenantHeader';
import { BrowseOff, CartOff } from '../components/RefusalList';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { renderResolved, text } from './store1b-harness';
import { C, SLUG, reset, withCookies } from './store6a-fixtures';

const CHROMES = [
  ['the platform', async () => renderResolved(await PlatformLayout({ children: <p>page</p> }), [SiteHeader]), ''],
  ['an organisation', async () => renderResolved(await TenantLayout({ children: <p>page</p>, params: { tenantSlug: SLUG } }), [TenantHeader]), `/${SLUG}`],
] as const;
const ribbon = (h: string) => { const i = h.indexOf('data-kv-ribbon='); return i < 0 ? '' : h.slice(h.lastIndexOf('<div', i), h.indexOf('</div>', i) + 6); };
beforeEach(() => reset());

describe('STORE-SWEEP-b · the ribbon in both chromes', () => {
  it.each(CHROMES)('%s: buying paused → "our side", "nothing was charged", the detours (browsing lots, your orders); mounted once, beside the offline guard', async (_n, render, base) => {
    C.flags = { storefront_cart: false, storefront_browse: true };
    const h = await render(); const r = ribbon(h);
    expect(h.match(/data-kv-ribbon=/g)).toHaveLength(1);
    expect(h.indexOf('data-kv-test="online-guard"')).toBeLessThan(h.indexOf('data-kv-ribbon='));
    expect(r).toContain('data-kv-ribbon="cart"');
    expect(r).toContain('role="status"');
    expect(text(r)).toContain(en['sweep.ribbon.cartOff']);
    expect(r).toContain(`href="${base}/search"`);
    expect(r).toContain(`href="${base}/orders"`);
  });
  it.each(CHROMES)('%s: browsing paused → "our side", your orders stay readable — no browse detour', async (_n, render, base) => {
    C.flags = { storefront_cart: true, storefront_browse: false };
    const r = ribbon(await render());
    expect(r).toContain('data-kv-ribbon="browse"');
    expect(text(r)).toContain(en['sweep.ribbon.browseOff']);
    expect(r).toContain(`href="${base}/orders"`);
    expect(r).not.toContain('data-kv-detour="browse"');
  });
  it.each(CHROMES)('%s: both paused → both features named', async (_n, render) => {
    C.flags = { storefront_cart: false, storefront_browse: false };
    const r = ribbon(await render());
    expect(r).toContain('data-kv-ribbon="both"');
    expect(r).toContain('data-kv-ribbon-feature="cart"'); expect(r).toContain('data-kv-ribbon-feature="browse"');
  });
  it.each(CHROMES)('%s: absent when both are ON, when the keys are absent, and when the flags cannot be read', async (_n, render) => {
    for (const f of [{ storefront_cart: true, storefront_browse: true }, {}, new Error('down')]) {
      C.flags = f as never;
      expect(await render()).not.toContain('data-kv-ribbon=');
    }
  });
  it('no time promise, no status page, no "next update" — in any language', async () => {
    for (const l of ['en', 'hi', 'gu']) {
      reset(); withCookies({ kv_lang: l }); C.flags = { storefront_cart: false, storefront_browse: false };
      const w = text(ribbon(await CHROMES[1][1]()));
      expect(w).not.toMatch(/\d{1,2}:\d{2}|status page|next update/i);
      if (l === 'hi') expect(w).toContain(hi['sweep.ribbon.cartOff']);
    }
  });
});

describe('STORE-SWEEP-b · the kill-switch pages say "our side" (founder D2 a)', () => {
  it('browsing off and buying off: our side; buying off: nothing was charged', () => {
    const b = text(renderToStaticMarkup(<BrowseOff />));
    const c = text(renderToStaticMarkup(<CartOff />));
    expect(b).toContain('our side'); expect(b).toContain(en['store2a.browseOff.body']);
    expect(c).toContain('our side'); expect(c).toContain('Nothing was charged');
  });
});
