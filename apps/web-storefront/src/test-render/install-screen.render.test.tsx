// apps/web-storefront/src/test-render/install-screen.render.test.tsx · PC-56 STORE-6a · C3 (canon W319, founders D3 / D4 / D6 / D7) — APP & INSTALL,
// UNDER BOTH CHROMES. On a store the page names the ORGANISATION (the installed app is its), never the platform store and never a platform app;
// no size figure ("3 MB", "small download"), no phone price; no install button (the invitation is 6b's) — the browser's own steps in words; the
// polite update and the language rule TRUE; offline: what this store keeps (its flag), the offline page, NOT orders or messages (+ the 6b
// "coming" line); the storage line (measured by the phone; "cannot tell" before) and "photos are never kept"; every W319 refusal by name.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./store6a-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./store6a-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient }; });
jest.mock('../lib/storefront-data', () => { const f = jest.requireActual('./store6a-fixtures'); return { loadTenantShell: f.loadTenantShell }; });
import PlatformApp from '../app/(platform)/app/page';
import TenantApp from '../app/[tenantSlug]/app/page';
import { PLATFORM_BRAND } from '@krishalaya/tokens';
import { store6RefusalKeys } from '../features/store6/refusals';
import { StorageLineView, roundMb } from '../components/offline/StorageLine';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, ORG, SLUG, reset } from './store6a-fixtures';

beforeEach(() => reset());
const tenant = async () => renderToStaticMarkup(await TenantApp({ params: { tenantSlug: SLUG } }));

describe('STORE-6a · W319 · app & install', () => {
  it('on a store: installs as THE ORGANISATION — its name in the title, the steps, the icon line; never the platform store or a platform app', async () => {
    const h = await tenant(); const words = text(h);
    expect(words).toContain(en['store6.install.title'].replace('{name}', ORG));
    expect(words).toContain(en['store6.install.lead'].replace('{name}', ORG));
    expect(words).toContain(en['store6.install.icon'].replace('{name}', ORG));
    expect(words).not.toContain(PLATFORM_BRAND.platformStoreName);
    expect(words).not.toMatch(new RegExp(`${PLATFORM_BRAND.name}|mobile app|offline-first`, 'i'));
    expect(C.api).toContainEqual(['flags', SLUG]);
  });
  it('no number of size or phone price, and no install button (the invitation is STORE-6b\'s)', async () => {
    for (const h of [await tenant(), renderToStaticMarkup(PlatformApp({}))]) {
      const words = text(h);
      expect(words).not.toMatch(/\d+(\.\d+)?\s?MB|6,?000|small download|smaller than three photos|speaks when asked/i);
      expect(h).not.toMatch(/<button|<form/);
      for (const how of ['android', 'iphone', 'other']) expect(h).toContain(`data-kv-install-how="${how}"`);
    }
  });
  it('TRUE lines: updates politely, the language at install; offline: the store\'s kept pages (its flag), NOT orders or messages; the money list link', async () => {
    let h = await tenant(); const words = text(h);
    expect(words).toContain(en['store6.install.update']); expect(words).toContain(en['store6.install.language']);
    expect(h).toContain('data-kv-not-kept="orders"'); expect(words).toContain(en['store6.queued.coming']);
    expect(words).toContain(en['store6.offline.keep.on'].replace('{org}', ORG).replace('{pages}', '20').replace('{days}', '7'));
    expect(h).toContain(`href="/${SLUG}/queued"`);
    C.flags = { storefront_offline_reads: false };
    h = await tenant();
    expect(text(h)).toContain(en['store6.offline.keep.off'].replace('{org}', ORG));
  });
  it('the platform\'s page installs as the platform store; its links are the platform\'s', () => {
    const h = renderToStaticMarkup(PlatformApp({}));
    expect(text(h)).toContain(en['store6.install.title'].replace('{name}', PLATFORM_BRAND.platformStoreName));
    expect(h).toContain('href="/queued"'); expect(h).toContain('href="/offline"');
  });
  it('the storage line: "cannot tell" before the phone measures; then the phone\'s own figure, rounded; photos never kept', async () => {
    const h = await tenant();
    expect(h).toContain('data-kv-storage="unknown"'); expect(text(h)).toContain(en['store6.install.storage.unknown']);
    expect(text(h)).toContain(en['store6.install.storage.photos']);
    const labels = { uses: en['store6.install.storage.uses'].replace('{name}', ORG), unknown: 'x' };
    expect(text(renderToStaticMarkup(<StorageLineView bytes={4.2 * 1024 * 1024} labels={labels} />))).toContain(`${ORG} is using about 4.2 MB on this phone.`);
    expect([roundMb(0), roundMb(30 * 1024), roundMb(41.6 * 1024 * 1024)]).toEqual(['0', '0.1', '42']);
  });
  it('every W319 refusal by name (11)', async () => {
    const words = text(await tenant());
    for (const k of store6RefusalKeys('install')) expect([k, words.includes(en[k])]).toEqual([k, true]);
    expect(store6RefusalKeys('install').length).toBe(11);
  });
});
