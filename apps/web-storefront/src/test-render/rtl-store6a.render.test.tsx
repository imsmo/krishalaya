// apps/web-storefront/src/test-render/rtl-store6a.render.test.tsx · PC-56 STORE-6a · C5 — the offline page (both chromes, and each chain state), the
// queued-actions list, the install page and the kept-page band under dir="rtl" carry no PHYSICAL-direction class or inline style and no bare
// arrow outside .kv-dir-flip (store1b-harness). In Hindi and Gujarati too.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./store6a-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./store6a-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient }; });
jest.mock('../lib/storefront-data', () => { const f = jest.requireActual('./store6a-fixtures'); return { loadTenantShell: f.loadTenantShell }; });
import ShellOffline from '../app/(shell)/offline/page';
import TenantOffline from '../app/[tenantSlug]/offline/page';
import PlatformQueued from '../app/(platform)/queued/page';
import TenantQueued from '../app/[tenantSlug]/queued/page';
import PlatformApp from '../app/(platform)/app/page';
import TenantApp from '../app/[tenantSlug]/app/page';
import { CachedBandView } from '../components/offline/CachedBand';
import { UpdateNoticeView } from '../components/offline/UpdateNotice';
import { bareArrows, physical, resolveTree } from './store1b-harness';
import { SLUG, reset, withCookies } from './store6a-fixtures';

const rtl = async (node: React.ReactNode) => renderToStaticMarkup(<div dir="rtl">{await resolveTree(node, [])}</div>);
const L = { offline: 'o', online: 'n', asOf: 'a', now: 'now', minutes: 'm', hours: 'h', days: 'd', ago: 'ago', pricesMoved: 'p', moneyWord: 'w', reload: 'r' };
const STATES: Array<[string, () => Promise<React.ReactNode> | React.ReactNode]> = [
  ['W313 platform', () => ShellOffline({ searchParams: {} })],
  ['W313 organisation', () => TenantOffline({ params: { tenantSlug: SLUG }, searchParams: {} })],
  ['W3127 error', () => TenantOffline({ params: { tenantSlug: SLUG }, searchParams: { form: 'error' } })],
  ['W3128 review', () => ShellOffline({ searchParams: { form: 'review' } })],
  ['W3129 success', () => TenantOffline({ params: { tenantSlug: SLUG }, searchParams: { form: 'success' } })],
  ['W3130 failure', () => ShellOffline({ searchParams: { form: 'failure' } })],
  ['W314 platform', () => PlatformQueued()],
  ['W314 organisation', () => TenantQueued({ params: { tenantSlug: SLUG } })],
  ['W319 platform', () => PlatformApp({})],
  ['W319 organisation', () => TenantApp({ params: { tenantSlug: SLUG } })],
  ['the kept-page band (full)', () => <CachedBandView at="2026-10-17T04:30:00.000Z" tier="full" online={false} labels={L} />],
  ['the update notice', () => <UpdateNoticeView show labels={{ ready: 'r', refresh: 'f', later: 'l' }} />],
];
beforeEach(() => reset());

describe('STORE-6a · rtl', () => {
  it.each(STATES)('%s: no physical-direction class or style, no bare arrow', async (_n, make) => {
    const html = await rtl(await make());
    expect(physical(html)).toEqual([]);
    expect(bareArrows(html)).toBe(0);
  });
  it('in Hindi and Gujarati too', async () => {
    for (const l of ['hi', 'gu']) for (const i of [1, 2, 7, 9]) {
      reset(); withCookies({ kv_lang: l });
      const html = await rtl(await STATES[i][1]());
      expect(physical(html)).toEqual([]);
      expect(bareArrows(html)).toBe(0);
    }
  });
});
