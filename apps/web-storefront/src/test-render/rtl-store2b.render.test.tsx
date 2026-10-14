// apps/web-storefront/src/test-render/rtl-store2b.render.test.tsx · PC-56 STORE-2b · C7 — the cart under dir="rtl": the cart with a changed price, a
// line that cannot be bought, the confirm and failure states of its chains, the empty / error / paused / sign-in states, and the listing's
// refused add carry no PHYSICAL-direction class or inline style, and the drift box's "added → now" arrow is the direction-safe DirArrow (no bare
// arrow outside .kv-dir-flip). Same guards as rtl-store2a (store1b-harness). In Hindi and Gujarati too.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({ ...jest.requireActual('next/navigation'), notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', featureAuctions: true, siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store2b-fixtures');
  return { getLang: () => f.W.lang, getTranslator: () => new Tr(f.W.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => jest.requireActual('./store2b-fixtures').W.token, requireSession: async () => 'tok' }));
jest.mock('../lib/auth', () => ({ getSessionTenant: () => jest.requireActual('./store2b-fixtures').W.sessionTenant, hasSessionCookie: () => true }));
jest.mock('../lib/storefront-data', () => ({ loadTenantShell: (s: string) => jest.requireActual('./store2b-fixtures').shell(s) }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store2b-fixtures');
  return { serverClient: f.serverClient, publicClient: (s?: string) => (s === 'lot' ? jest.requireActual('./store2a-fixtures').apiClient() : f.publicClient()), sessionTenantClient: f.sessionTenantClient };
});
jest.mock('../app/[tenantSlug]/cart/actions', () => ({ updateCartLineAction: async () => undefined, removeCartLineAction: async () => undefined, acceptPriceAction: async () => undefined }));

import TenantCart from '../app/[tenantSlug]/cart/page';
import ListingDetail from '../app/[tenantSlug]/listings/[id]/page';
import { bareArrows, physical, resolveTree } from './store1b-harness';
import { W, reset, LINE, DRIFT, REASON, ID } from './store2b-fixtures';
import { reset as resetA, L1 } from './store2a-fixtures';

const rtl = async (node: React.ReactNode) => renderToStaticMarkup(<div dir="rtl">{await resolveTree(node, [])}</div>);
const cart = (sp: Record<string, string> = {}) => TenantCart({ params: { tenantSlug: 'anand-fpo' }, searchParams: sp });
beforeEach(() => { reset(); resetA(); W.cart = { items: [LINE(ID.ok), DRIFT, REASON(ID.sold, 'sold_out')], subtotalMinor: '8198000', currencyCode: 'INR' }; });

const STATES: Array<[string, () => Promise<React.ReactNode>]> = [
  ['the cart (a changed price, a line that cannot be bought)', () => cart()],
  ['W3041 a quantity refused, the value kept', () => cart({ step: 'error', line: ID.ok, err: 'below_min', qty: '3' })],
  ['W3045 the Remove confirm', () => cart({ step: 'confirm', act: 'remove', line: ID.ok })],
  ['W3045 the Accept confirm (both numbers)', () => cart({ step: 'confirm', act: 'accept', line: ID.drift })],
  ['W3047 the price changed again', () => cart({ step: 'failure', act: 'accept', line: ID.drift, err: 'price_changed' })],
  ['empty', async () => { W.cart = { items: [], subtotalMinor: '0', currencyCode: null }; return cart(); }],
  ['error with Retry', async () => { W.cart = new Error('down'); return cart(); }],
  ['buying paused', async () => { W.flags = { ...W.flags, storefront_cart: false }; return cart(); }],
  ['sign-in required', async () => { W.token = null; return cart(); }],
  ['W3099 the listing with a refused add', () => ListingDetail({ params: { tenantSlug: 'lot', id: L1 }, searchParams: { step: 'error', refusal: 'below_min', qty: '3' } })],
];

describe('STORE-2b · rtl', () => {
  it.each(STATES)('%s: no physical-direction class or style, no bare arrow', async (_name, make) => {
    const html = await rtl(await make());
    expect(physical(html)).toEqual([]);
    expect(bareArrows(html)).toBe(0);
  });
  it('the drift box\'s "added → now" arrow flips (DirArrow)', async () => {
    expect(await rtl(await cart())).toMatch(/data-kv-price="added">[^<]+<\/span> <span class="kv-dir-flip">→<\/span>/);
  });
  it('in Hindi and Gujarati too (the same markup rules hold in every catalogue)', async () => {
    for (const lang of ['hi', 'gu']) {
      W.lang = lang;
      const html = await rtl(await cart());
      expect(physical(html)).toEqual([]);
      expect(bareArrows(html)).toBe(0);
    }
  });
});
