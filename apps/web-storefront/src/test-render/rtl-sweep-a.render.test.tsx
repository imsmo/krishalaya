// apps/web-storefront/src/test-render/rtl-sweep-a.render.test.tsx · PC-56 STORE-SWEEP-a · C3 — Help (both chromes, both money cases), the quality
// promise (both chromes, disputes ON / OFF), Trust & your data (facts empty and set), Contact (platform and store), About, Press and the store
// footer under dir="rtl" carry no PHYSICAL-direction class or inline style and no bare arrow outside .kv-dir-flip (store1b-harness). In Hindi and
// Gujarati too.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./sweep-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./sweep-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient }; });
jest.mock('../lib/storefront-data', () => { const f = jest.requireActual('./sweep-fixtures'); return { loadTenantShell: f.loadTenantShell }; });
import PlatformHelp from '../app/(platform)/help/page';
import TenantHelp from '../app/[tenantSlug]/help/page';
import PlatformQuality from '../app/(platform)/quality-promise/page';
import TenantQuality from '../app/[tenantSlug]/quality-promise/page';
import TrustData from '../app/(platform)/trust-data/page';
import Contact from '../app/(platform)/contact/page';
import StoreContact from '../app/[tenantSlug]/contact/page';
import About from '../app/(platform)/about/page';
import Press from '../app/(platform)/press/page';
import { TenantFooter } from '../components/TenantFooter';
import { bareArrows, physical, resolveTree } from './store1b-harness';
import { FULL_FACTS, S, SLUG, reset } from './sweep-fixtures';

const rtl = async (node: React.ReactNode) => renderToStaticMarkup(<div dir="rtl">{await resolveTree(node, [])}</div>);
const STATES: Array<[string, () => Promise<React.ReactNode> | React.ReactNode]> = [
  ['W311 platform', () => PlatformHelp()],
  ['W311 organisation (pay on delivery)', () => TenantHelp({ params: { tenantSlug: SLUG } })],
  ['W311 organisation (online)', () => { S.flags = { online_payments: true }; return TenantHelp({ params: { tenantSlug: SLUG } }); }],
  ['W309 platform', () => PlatformQuality()],
  ['W309 organisation (disputes ON)', () => { S.flags = { disputes: true }; return TenantQuality({ params: { tenantSlug: SLUG } }); }],
  ['W309 organisation (disputes OFF)', () => TenantQuality({ params: { tenantSlug: SLUG } })],
  ['W310 (facts empty)', () => TrustData()],
  ['W310 (facts set)', () => { S.facts = FULL_FACTS; return TrustData(); }],
  ['W312 platform', () => Contact()],
  ['the store\'s contact page', () => StoreContact({ params: { tenantSlug: SLUG } })],
  ['W308 About', () => About()],
  ['Press', () => Press()],
  ['the store footer', () => <TenantFooter name="Anand FPO" slug={SLUG} showPoweredBy platformOrigin="https://bazaar.example.test" />],
];
beforeEach(() => reset());

describe('STORE-SWEEP-a · rtl', () => {
  it.each(STATES)('%s: no physical-direction class or style, no bare arrow', async (_n, make) => {
    const html = await rtl(await make());
    expect(physical(html)).toEqual([]);
    expect(bareArrows(html)).toBe(0);
  });
  it.each(['hi', 'gu'])('%s: the same pages, no physical class or bare arrow', async (lang) => {
    for (const [, make] of STATES) {
      reset(); S.lang = lang;
      const html = await rtl(await make());
      expect(physical(html)).toEqual([]);
      expect(bareArrows(html)).toBe(0);
    }
  });
});
