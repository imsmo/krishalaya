// apps/web-storefront/src/test-render/rtl-sweep-b.render.test.tsx · PC-56 STORE-SWEEP-b · C3 — the delivery section (every state), the language page (both
// chromes), the boundaries (a store's and the platform's 404 / error, global-error), the ribbon and the store's trace entry under dir="rtl" carry no
// PHYSICAL-direction class or inline style and no bare arrow outside .kv-dir-flip (store1b-harness). In Hindi and Gujarati too. (The automated half of
// the RTL spot-check; the manual browser pass is owed.)
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./sweep-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./sweep-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient }; });
import PlatformLanguage from '../app/(platform)/language/page';
import TenantLanguage from '../app/[tenantSlug]/language/page';
import TenantNotFound from '../app/[tenantSlug]/not-found';
import TenantError from '../app/[tenantSlug]/error';
import GlobalError from '../app/global-error';
import { TrackingSection } from '../components/sweep/TrackingSection';
import { KillSwitchRibbon } from '../components/sweep/KillSwitchRibbon';
import { BoundaryProvider } from '../components/sweep/BoundaryContext';
import { TraceEntry } from '../components/sweep/TraceEntry';
import { PLATFORM_CHROME, tenantChrome } from '../features/store4a/account';
import { bareArrows, physical } from './store1b-harness';
import { S, SLUG, reset } from './sweep-fixtures';

const JOURNEY = { ok: true as const, data: {
  shipment: { status: 'failed', awbNo: 'AWB-1', riderAssigned: true, deliveryAttempts: 2 },
  shipmentEvents: [{ status: 'picked_up', at: '2026-10-16T05:10:00.000Z' }, { status: 'out_for_delivery', at: '2026-10-16T09:00:00.000Z' }, { status: 'failed', at: '2026-10-16T11:00:00.000Z' }],
} };
const STORE = { slug: SLUG, name: 'Anand FPO Mandi' };
const err = Object.assign(new Error('x'), { digest: '42' });
const rtl = (node: React.ReactNode) => renderToStaticMarkup(<div dir="rtl">{node}</div>);
const STATES: Array<[string, () => React.ReactNode]> = [
  ['W292 the journey', () => <TrackingSection state="journey" load={JOURNEY} reloadHref="/x#tracking" />],
  ['W292 pending', () => <TrackingSection state="pending" load={{ ok: true, data: { shipment: null, shipmentEvents: [] } }} reloadHref="/x#tracking" />],
  ['W292 off', () => <TrackingSection state="off" load={null} reloadHref="/x#tracking" />],
  ['W292 unknown', () => <TrackingSection state="unknown" load={null} reloadHref="/x#tracking" />],
  ['W292 error', () => <TrackingSection state="error" load={{ ok: false }} reloadHref="/x#tracking" />],
  ['W323 platform', () => PlatformLanguage({ searchParams: {} })],
  ['W323 organisation', () => TenantLanguage({ params: { tenantSlug: SLUG }, searchParams: {} })],
  ['W316 a store\'s 404', () => <BoundaryProvider store={STORE} lang={S.lang}><TenantNotFound /></BoundaryProvider>],
  ['W316 a store\'s error', () => <BoundaryProvider store={STORE} lang={S.lang}><TenantError error={err} reset={() => undefined} /></BoundaryProvider>],
  ['W316 the platform\'s 404', () => <BoundaryProvider store={null} lang={S.lang}><TenantNotFound /></BoundaryProvider>],
  ['W320 the ribbon (both paused, a store)', () => <KillSwitchRibbon chrome={tenantChrome(SLUG)} flags={{ storefront_cart: false, storefront_browse: false }} />],
  ['W320 the ribbon (buying paused, the platform)', () => <KillSwitchRibbon chrome={PLATFORM_CHROME} flags={{ storefront_cart: false }} />],
  ['the store\'s trace entry', () => <TraceEntry base={`/${SLUG}`} searchParams={{ code: '../x' }} />],
];
beforeEach(() => reset());

describe('STORE-SWEEP-b · rtl', () => {
  it.each(STATES)('%s: no physical-direction class or style, no bare arrow', (_n, make) => {
    const html = rtl(make());
    expect(physical(html)).toEqual([]);
    expect(bareArrows(html)).toBe(0);
  });
  it.each(['hi', 'gu'])('%s: the same pages, no physical class or bare arrow', (lang) => {
    for (const [, make] of STATES) {
      reset(); S.lang = lang;
      const html = rtl(make());
      expect(physical(html)).toEqual([]);
      expect(bareArrows(html)).toBe(0);
    }
  });
  it('global-error: no physical class or bare arrow', () => {
    const html = renderToStaticMarkup(<GlobalError error={err} reset={() => undefined} />);
    expect(physical(html)).toEqual([]);
    expect(bareArrows(html)).toBe(0);
  });
});
