// apps/web-storefront/src/test-render/rtl-store2c.render.test.tsx · PC-56 STORE-2c · C7 — the money pages under dir="rtl": the three checkout steps
// (with the add-address chain's form-error and the stock-shrank state), the pay page in each attempt state, the confirmation and the auction carry
// no PHYSICAL-direction class or inline style and no bare arrow outside .kv-dir-flip. Same guards as rtl-store2a / 2b (store1b-harness). In Hindi
// and Gujarati too.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SdkError } from '@krishalaya/sdk-js';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }) }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: jest.requireActual('./store2c-fixtures').C.pending === true }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', featureAuctions: false, siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: 'rzp_test_x' } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store2c-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => jest.requireActual('./store2c-fixtures').C.token, requireSession: async () => 'tok' }));
jest.mock('../lib/auth', () => ({ getSessionTenant: () => jest.requireActual('./store2c-fixtures').C.sessionTenant }));
jest.mock('../lib/storefront-data', () => ({ loadTenantShell: (s: string) => jest.requireActual('./store2c-fixtures').shell(s) }));
jest.mock('../lib/checkout-flow', () => jest.requireActual('./store2c-fixtures').checkoutFlow);
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store2c-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});

import TenantCheckout from '../app/[tenantSlug]/checkout/page';
import TenantPayPage from '../app/[tenantSlug]/checkout/pay/page';
import TenantConfirmPage from '../app/[tenantSlug]/checkout/confirm/page';
import TenantAuctionPage from '../app/[tenantSlug]/auctions/[id]/page';
import { bareArrows, physical, resolveTree } from './store1b-harness';
import { C, reset, O, ORDER, AUCTION } from './store2c-fixtures';

const rtl = async (node: React.ReactNode) => renderToStaticMarkup(<div dir="rtl">{await resolveTree(node, [])}</div>);
const co = (sp: Record<string, string>) => TenantCheckout({ params: { tenantSlug: 'anand-fpo' }, searchParams: sp });
const pay = () => TenantPayPage({ params: { tenantSlug: 'anand-fpo' }, searchParams: { o: O.a } });
beforeEach(() => { reset(); C.orders[O.a] = ORDER(O.a, 'pending'); });
void SdkError;

const STATES: Array<[string, () => Promise<React.ReactNode>]> = [
  ['W283 the address step', () => co({ step: 'address' })],
  ['W3048 the add-address form-error', async () => { C.state = { ...C.state, draft: { values: { line1: 'ab', line2: '', village: '', pincode: '12', countryCode: 'IN', contactName: '', contactPhone: '', labelId: '' }, errors: { line1: 'too_short', pincode: 'postal' }, failure: null } }; return co({ step: 'address', add: '1', status: 'form_error' }); }],
  ['W284 the payment step', () => co({ step: 'payment' })],
  ['W285 the review', () => co({ step: 'review' })],
  ['W285 the stock that shrank', () => co({ step: 'review', status: 'stock', available: '4.000' })],
  ['W286 pay — no attempt', () => pay()],
  ['W286 pay — failed with a reason', async () => { C.attempts[O.a] = { latest: { id: 'p', status: 'failed', failureReason: 'declined', chargedNothing: true }, attempts: 1, nextAttempt: 2, liveAttempt: false, ttlSeconds: 900 }; return pay(); }],
  ['the confirmation (a group)', async () => { C.group = { orders: [{ id: O.a }, { id: O.b }] }; C.orders[O.b] = ORDER(O.b, 'paid'); return TenantConfirmPage({ params: { tenantSlug: 'anand-fpo' }, searchParams: { g: 'g1' } }); }],
  ['W278 the auction', () => TenantAuctionPage({ params: { tenantSlug: 'anand-fpo', id: AUCTION }, searchParams: {} })],
];

describe('STORE-2c · rtl', () => {
  it.each(STATES)('%s: no physical-direction class or style, no bare arrow', async (_name, make) => {
    const html = await rtl(await make());
    expect(physical(html)).toEqual([]);
    expect(bareArrows(html)).toBe(0);
  });
  it('in Hindi and Gujarati too', async () => {
    for (const lang of ['hi', 'gu']) {
      C.lang = lang;
      for (const [, make] of STATES.slice(0, 4)) {
        const html = await rtl(await make());
        expect(physical(html)).toEqual([]);
        expect(bareArrows(html)).toBe(0);
      }
    }
  });
});
