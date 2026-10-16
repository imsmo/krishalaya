// apps/web-storefront/src/test-render/tenant-header-store4b.render.test.tsx · PC-56 STORE-4b · C5 — the Messages links point at the ORGANISATION's
// list (/<slug>/messages, canon W297):
//   • TenantHeader → THIS store's /<slug>/messages (signed in, the store's `communication` ON); never the platform /messages;
//   • SiteHeader → the SESSION store's /<slug>/messages (the 2b door rule: the slug read with its flags); a slug that cannot be read → the
//     platform /messages door (which says so); OFF → no link;
//   • no "n unread" badge beside Messages (no bounded count endpoint — refused by name on the list).
import * as React from 'react';
import { SdkError } from '@krishalaya/sdk-js';

const auth = { signedIn: true };
jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, usePathname: () => '/anand-fpo', useSearchParams: () => null }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store4b-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/auth', () => ({ hasSessionCookie: () => auth.signedIn }));
jest.mock('../features/cart/summary', () => ({ getCartItemCount: async () => 0 }));
jest.mock('../app/(platform)/login/actions', () => ({ logoutAction: async () => undefined }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store4b-fixtures');
  return { serverClient: f.serverClient, publicClient: (slug?: string) => ({ ...f.publicClient(slug), lookups: { categories: async () => [] } }), sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import { TenantHeader } from '../components/TenantHeader';
import { SiteHeader } from '../components/SiteHeader';
import { renderResolved } from './store1b-harness';
import { C, reset } from './store4b-fixtures';

const tenant = () => renderResolved(<TenantHeader slug="anand-fpo" name="Anand FPO" logoSrc={null} showPoweredBy />, [TenantHeader]);
const site = () => renderResolved(<SiteHeader />, [SiteHeader]);
beforeEach(() => { reset(); auth.signedIn = true; });

describe('STORE-4b · C5 the Messages links', () => {
  it('TenantHeader → /<slug>/messages (never the platform /messages); OFF → no link; no unread badge beside it', async () => {
    const h = await tenant();
    expect(h).toContain('data-kv-nav="messages" href="/anand-fpo/messages"');
    expect(h).not.toContain('href="/messages"');
    expect(h).not.toMatch(/data-kv-nav="messages"[^>]*>[^<]*<span/);
    C.flags = { ...C.flags, communication: false };
    expect(await tenant()).not.toContain('data-kv-nav="messages"');
  });
  it('SiteHeader → the SESSION store\'s /<slug>/messages; its slug unreadable → the platform door; OFF → none', async () => {
    C.sessionFlags = { communication: true };
    expect(await site()).toContain('data-kv-nav="messages" href="/anand-fpo/messages"');
    C.fail.storeSlug = new SdkError('UNAVAILABLE', 503, 'x');
    expect(await site()).toContain('data-kv-nav="messages" href="/messages"');
    C.sessionFlags = { communication: false };
    expect(await site()).not.toContain('data-kv-nav="messages"');
  });
  it('signed out: no Messages link at all', async () => {
    auth.signedIn = false; C.sessionFlags = { communication: true };
    expect(await tenant()).not.toContain('data-kv-nav="messages"');
    expect(await site()).not.toContain('data-kv-nav="messages"');
  });
});
