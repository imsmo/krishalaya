// apps/web-storefront/src/test-render/tenant-header-store4c.render.test.tsx · PC-56 STORE-4c · C1 (survey F-8, founder Q12) — the chrome a signed-in
// buyer is never stranded in:
//   • TenantHeader: Orders (/<slug>/orders), Notifications (/<slug>/notifications — never switched off), Messages ONLY when this store's
//     `communication` flag is ON (chat stays behind it; unreadable flags → no link), and Sign out (the existing logout action);
//     an anonymous visitor sees none of them — Sign in instead;
//   • SiteHeader: Messages only when the SESSION store's `communication` is ON; Notifications always for a signed-in buyer.
import * as React from 'react';
import { SdkError } from '@krishalaya/sdk-js';

const auth = { signedIn: true };
jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, usePathname: () => '/anand-fpo', useSearchParams: () => null }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store4c-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/auth', () => ({ hasSessionCookie: () => auth.signedIn }));
jest.mock('../features/cart/summary', () => ({ getCartItemCount: async () => 0 }));
jest.mock('../app/(platform)/login/actions', () => ({ logoutAction: async () => undefined }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store4c-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import { TenantHeader } from '../components/TenantHeader';
import { SiteHeader } from '../components/SiteHeader';
import { renderResolved, text } from './store1b-harness';
import { en } from '../i18n/en';
import { C, reset } from './store4c-fixtures';

const tenant = () => renderResolved(<TenantHeader slug="anand-fpo" name="Anand FPO" logoSrc={null} showPoweredBy />, [TenantHeader]);
const site = () => renderResolved(<SiteHeader />, [SiteHeader]);
beforeEach(() => { reset(); auth.signedIn = true; });

describe('STORE-4c · F-8 the tenant header for a signed-in buyer', () => {
  it('Orders · Notifications · Account · Sign out — under THIS organisation; Messages hidden while `communication` is OFF', async () => {
    const h = await tenant();
    expect(h).toContain('data-kv-nav="orders" href="/anand-fpo/orders"');
    expect(h).toContain('data-kv-nav="notifications" href="/anand-fpo/notifications"');
    expect(h).toContain('data-kv-nav="account" href="/anand-fpo/account"');
    expect(h).toContain('data-kv-nav="logout"'); expect(text(h)).toContain(en['nav.logout']);
    expect(h).not.toContain('data-kv-nav="messages"');
  });
  it('Messages appears when the store\'s `communication` flag is ON — and disappears when the flags cannot be read (fail closed)', async () => {
    C.flags = { ...C.flags, communication: true };
    expect(await tenant()).toContain('data-kv-nav="messages" href="/anand-fpo/messages"');   // PC-56 STORE-4b · C5: THIS store's list
    C.fail.flags = new SdkError('UNAVAILABLE', 503, 'x');
    const h = await tenant();
    expect(h).not.toContain('data-kv-nav="messages"');
    expect(h).toContain('data-kv-nav="notifications"');   // the inbox never depends on the flag
  });
  it('an anonymous visitor: none of them — Sign in to THIS store', async () => {
    auth.signedIn = false; C.flags = { ...C.flags, communication: true };
    const h = await tenant();
    for (const n of ['orders', 'notifications', 'messages', 'account', 'logout']) expect(h).not.toContain(`data-kv-nav="${n}"`);
    expect(h).toContain('href="/anand-fpo/login"');
  });
});

describe('STORE-4c · the platform header', () => {
  it('Messages only when the SESSION store\'s `communication` is ON; Notifications always for a signed-in buyer', async () => {
    let h = await site();
    expect(h).not.toContain('data-kv-nav="messages"'); expect(h).toContain('data-kv-nav="notifications" href="/notifications"');
    C.sessionFlags = { communication: true };
    h = await site();
    expect(h).toContain('data-kv-nav="messages" href="/anand-fpo/messages"');   // PC-56 STORE-4b · C5: the session store's list
  });
});
