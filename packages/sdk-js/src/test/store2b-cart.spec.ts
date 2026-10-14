// @krishalaya/sdk-js · PC-56 STORE-2b — the cart contract the storefront stands on, pinned with an injected fake fetch (no network): decimal
// quantities travel as STRINGS (add and update), the accept-price act posts the price the buyer was shown to its own route and returns the
// accepted figures + the re-read cart, a cart line carries BOTH prices, the server's delta, the minimum, the reason by name and the
// organisation (never a person); the refusals arrive as SdkError with their named codes and details; the flags carry storefront_cart.
import { createClient } from '../client';
import { SdkError } from '../errors';
import { CART_REFUSAL_CODES } from '../types';
import type { AcceptPriceResult, Cart, CartItem, StorefrontFlags } from '../types';

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (call: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const fn = (async (url: unknown, init: unknown) => {
    const call = { url: String(url), init: (init ?? {}) as RequestInit }; calls.push(call);
    const r = handler(call);
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const hdr = (c: Call) => (c.init.headers ?? {}) as Record<string, string>;
const client = (fn: typeof fetch) => createClient({ baseUrl: 'https://api.test', getToken: () => 'tok', tenantSlug: 'anand-fpo', fetchImpl: fn });

const LINE: CartItem = {
  listingId: 'l1', title: 'Lokwan wheat', quantity: 8, quantityDecimal: '8.000', unitCode: 'quintal', minOrderQty: '2.000', quantityAvailable: '34.000',
  available: 34, addedPriceMinor: '252000', currentPriceMinor: '256000', priceChanged: true, priceDeltaMinor: '4000', unitPriceMinor: '256000',
  lineTotalMinor: '2048000', currencyCode: 'INR', purchasable: true, reason: null, belowMin: false, overAvailable: false,
  organisation: { slug: 'anand-fpo', name: 'Anand FPO' }, district: 'Anand',
};

describe('PC-56 STORE-2b · SDK cart', () => {
  it('addItem / updateItem send a DECIMAL STRING quantity unchanged (never a float), with the store slug and the session', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 201, body: { data: { ok: true } } }));
    await client(fn).cart.addItem('l1', '2.5');
    await client(fn).cart.updateItem('l1', '0.125');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ listingId: 'l1', quantity: '2.5' });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ quantity: '0.125' });
    expect([new URL(calls[1].url).pathname, calls[1].init.method]).toEqual(['/v1/cart/items/l1', 'PATCH']);
    expect(hdr(calls[0])['x-tenant-slug']).toBe('anand-fpo');
    expect(hdr(calls[0]).authorization).toBe('Bearer tok');
  });

  it('acceptPrice posts the price the buyer was SHOWN to its own route and returns what was accepted + the cart', async () => {
    const result: AcceptPriceResult = {
      accepted: { listingId: 'l1', changed: true, previousPriceMinor: '252000', acceptedPriceMinor: '256000', currencyCode: 'INR', acceptedAt: '2026-10-15T04:00:00.000Z' },
      cart: { items: [{ ...LINE, addedPriceMinor: '256000', priceChanged: false, priceDeltaMinor: null }], subtotalMinor: '2048000', currencyCode: 'INR' },
    };
    const { fn, calls } = fakeFetch(() => ({ body: { data: result } }));
    const r = await client(fn).cart.acceptPrice('l1', '256000');
    expect([new URL(calls[0].url).pathname, calls[0].init.method]).toEqual(['/v1/cart/items/l1/accept-price', 'POST']);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ expectedPriceMinor: '256000' });
    expect([r.accepted.changed, r.accepted.acceptedPriceMinor, r.cart.items[0].priceChanged]).toEqual([true, '256000', false]);
    await client(fn).cart.acceptPrice('l1');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({});
  });

  it('a cart line carries both prices, the server delta, the minimum, the reason by name and the organisation — no person', async () => {
    const cart: Cart = { items: [LINE, { ...LINE, listingId: 'l2', reason: 'suspended', purchasable: false }], subtotalMinor: '2048000', currencyCode: 'INR' };
    const { fn } = fakeFetch(() => ({ body: { data: cart } }));
    const c = await client(fn).cart.get();
    expect([c.items[0].addedPriceMinor, c.items[0].currentPriceMinor, c.items[0].priceDeltaMinor, c.items[0].minOrderQty]).toEqual(['252000', '256000', '4000', '2.000']);
    expect(c.items[1].reason).toBe('suspended');
    expect(JSON.stringify(c)).not.toMatch(/sellerUserId|fullName|farmer/);
  });

  it('a refusal arrives as SdkError with its named code and details (BELOW_MIN_ORDER, PRICE_CHANGED, WRONG_STORE, LICENCE_REQUIRED); the code list; the flags carry storefront_cart', async () => {
    const cases: Array<[number, string, Record<string, unknown>]> = [
      [422, 'BELOW_MIN_ORDER', { listingId: 'l1', minOrderQty: '5.000', unitCode: 'quintal', requested: '3.000' }],
      [409, 'PRICE_CHANGED', { listingId: 'l1', addedPriceMinor: '252000', currentPriceMinor: '256000', currencyCode: 'INR' }],
      [409, 'WRONG_STORE', { listingId: 'l1', listingTenantSlug: 'girnar-fpo', listingTenantName: 'Girnar FPO' }],
      [422, 'LICENCE_REQUIRED', { listingId: 'l1' }],
    ];
    for (const [status, code, details] of cases) {
      const { fn } = fakeFetch(() => ({ status, body: { error: { code, message: code, details } } }));
      const e = await client(fn).cart.addItem('l1', '3').catch((x: unknown) => x);
      expect(e).toBeInstanceOf(SdkError);
      expect([(e as SdkError).code, (e as SdkError).status, (e as SdkError).details]).toEqual([code, status, details]);
    }
    expect([...CART_REFUSAL_CODES]).toEqual(['BELOW_MIN_ORDER', 'PRICE_CHANGED', 'LICENCE_REQUIRED', 'BANNED_IN_REGION', 'WRONG_STORE',
      'LISTING_NOT_PURCHASABLE', 'LISTING_INSUFFICIENT_STOCK', 'STOREFRONT_CART_OFF']);
    const f: StorefrontFlags = { org_self_signup: true, storefront_browse: true, storefront_cart: false };
    expect(f.storefront_cart).toBe(false);
  });
});
