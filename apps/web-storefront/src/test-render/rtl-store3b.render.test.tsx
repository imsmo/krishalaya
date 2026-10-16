// apps/web-storefront/src/test-render/rtl-store3b.render.test.tsx · PC-56 STORE-3b · C6 — the offer pages under dir="rtl": the list (rows,
// empty, error, flag off), the thread (the acts, the three confirms, a named failure, the creating state, a converted offer) carry no PHYSICAL-
// direction class or inline style and no bare arrow outside .kv-dir-flip. Same guards as rtl-store3a (store1b-harness). In Hindi and Gujarati too.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }) }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) }));
jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: jest.requireActual('./store3b-fixtures').C.pending === true }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: 'rzp_test_x' } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store3b-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/auth', () => ({ getSessionTenant: () => 't', hasSessionCookie: () => true }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store3b-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import TenantOffersPage from '../app/[tenantSlug]/offers/page';
import TenantOfferThread from '../app/[tenantSlug]/offers/[id]/page';
import { bareArrows, physical, resolveTree } from './store1b-harness';
import { C, reset, OFFER, OFF, SLUG, ORDER_ID } from './store3b-fixtures';

const rtl = async (node: React.ReactNode) => renderToStaticMarkup(<div dir="rtl">{await resolveTree(node, [])}</div>);
const list = (sp: Record<string, string> = {}) => TenantOffersPage({ params: { tenantSlug: SLUG }, searchParams: sp });
const thread = (id: string, sp: Record<string, string> = {}) => TenantOfferThread({ params: { tenantSlug: SLUG, id }, searchParams: sp });
beforeEach(() => {
  reset();
  C.offers[OFF.countered] = OFFER(OFF.countered);
  C.offers[OFF.accepted] = OFFER(OFF.accepted, { status: 'accepted', conversion: 'creating', yourTurn: false, allowedActs: [] });
  C.offers[OFF.converted] = OFFER(OFF.converted, { status: 'converted', convertedOrderId: ORDER_ID, convertedOrderStatus: 'created', yourTurn: false, allowedActs: [] });
});

const STATES: Array<[string, () => Promise<React.ReactNode>]> = [
  ['W293 the list (rows)', async () => { C.list.all = [OFFER(OFF.countered), OFFER(OFF.expired, { status: 'expired', yourTurn: false, allowedActs: [] })]; return list(); }],
  ['W293 empty', () => list({ status: 'open' })],
  ['W293 error', async () => { C.list.all = new Error('down'); return list(); }],
  ['W293 flag off', async () => { C.flags = { ...C.flags, offers: false }; return list(); }],
  ['W294 the acts', () => thread(OFF.countered)],
  ['W3121 accept confirm', () => thread(OFF.countered, { act: 'accept' })],
  ['W3121 counter confirm', () => thread(OFF.countered, { act: 'counter', price: '2470' })],
  ['W3121 decline confirm', () => thread(OFF.countered, { act: 'decline' })],
  ['W3123 a named failure', () => thread(OFF.countered, { act: 'accept', error: 'stock_short', av: '4.500', k: 'accept:x:0211aaaa-0000-7000-8000-000000000003' })],
  ['W3122 creating', () => thread(OFF.accepted, { ok: 'accepted' })],
  ['W3122 converted', () => thread(OFF.converted)],
];

describe('STORE-3b · rtl', () => {
  it.each(STATES)('%s: no physical-direction class or style, no bare arrow', async (_name, make) => {
    const html = await rtl(await make());
    expect(physical(html)).toEqual([]);
    expect(bareArrows(html)).toBe(0);
  });
  it('in Hindi and Gujarati too', async () => {
    for (const lang of ['hi', 'gu']) {
      for (const [, make] of STATES) {
        reset(); C.lang = lang;
        C.offers[OFF.countered] = OFFER(OFF.countered);
        C.offers[OFF.accepted] = OFFER(OFF.accepted, { status: 'accepted', conversion: 'creating', yourTurn: false, allowedActs: [] });
        C.offers[OFF.converted] = OFFER(OFF.converted, { status: 'converted', convertedOrderId: ORDER_ID, convertedOrderStatus: 'created', yourTurn: false, allowedActs: [] });
        const html = await rtl(await make());
        expect(physical(html)).toEqual([]);
        expect(bareArrows(html)).toBe(0);
      }
    }
  });
});
