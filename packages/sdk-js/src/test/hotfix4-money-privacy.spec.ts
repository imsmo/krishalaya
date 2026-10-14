// @krishalaya/sdk-js · PC-56 HOTFIX-4 — the shapes the storefront's money and privacy truth stands on, pinned with an injected fake fetch
// (no network): the order's paymentState + the two buyer-side charges, the checkout result's paymentState, the preview with the address,
// the checkout group read, the public listing's allow-list, the nameless seller read, the five new public flags, the cart's currency.
import { createClient } from '../client';
import type { CheckoutPreview, OrderDetail, PublicListingDetail, SellerPublicProfile, StorefrontFlags, Cart, CheckoutResult } from '../types';

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
const client = (fn: typeof fetch) => createClient({ baseUrl: 'https://api.test', getToken: () => 'tok', fetchImpl: fn });

describe('PC-56 HOTFIX-4 · SDK', () => {
  it('orders.get carries paymentState + platformFeeMinor + buyerCommissionMinor as STRINGS; the rows sum to the total', async () => {
    const data: Omit<OrderDetail, 'items'> & { items: [] } = { id: 'o1', orderNo: 'KV2026-1', status: 'confirmed', paymentState: 'paid', source: 'direct',
      buyerUserId: 'b', sellerUserId: 's', currencyCode: 'INR', subtotalMinor: '1845000', deliveryFeeMinor: '7500', discountMinor: '10000',
      taxMinor: '0', commissionMinor: '0', platformFeeMinor: '46125', buyerCommissionMinor: '43542', totalMinor: '1932167', items: [] };
    const { fn } = fakeFetch(() => ({ body: { data } }));
    const o = await client(fn).orders.get('o1');
    expect(o.paymentState).toBe('paid');
    for (const k of ['platformFeeMinor', 'buyerCommissionMinor', 'totalMinor'] as const) expect(typeof o[k]).toBe('string');
    const sum = BigInt(o.subtotalMinor) + BigInt(o.deliveryFeeMinor) + BigInt(o.taxMinor) - BigInt(o.discountMinor) + BigInt(o.platformFeeMinor) + BigInt(o.buyerCommissionMinor);
    expect(sum.toString()).toBe(o.totalMinor);
  });

  it('checkout.checkout result names each order\'s paymentState (the next step comes from the ORDER, never a payment vocabulary)', async () => {
    const data: CheckoutResult = { checkoutGroupId: 'g1', orders: [{ id: 'o1', orderNo: 'A', totalMinor: '100', status: 'created', paymentState: 'none' },
      { id: 'o2', orderNo: 'B', totalMinor: '200', status: 'created', paymentState: 'none' }] };
    const { fn } = fakeFetch(() => ({ status: 201, body: { data } }));
    const r = await client(fn).checkout.checkout({}, 'key-1');
    expect(r.orders.map((o) => o.paymentState)).toEqual(['none', 'none']);
  });

  it('checkout.preview sends the CHOSEN address + delivery option; the result carries deliveryNeedsAddress + buyerCommissionMinor', async () => {
    const data: CheckoutPreview = { currencyCode: 'INR', sellers: [], subtotalMinor: '1845000', deliveryFeeMinor: '7500', platformFeeMinor: '46125',
      discountMinor: '0', buyerCommissionMinor: '43542', deliveryNeedsAddress: false, grandTotalMinor: '1942167', couponCode: null };
    const { fn, calls } = fakeFetch(() => ({ body: { data } }));
    const p = await client(fn).checkout.preview({ deliveryAddressId: 'a1', deliveryMethodId: 'z1' });
    expect(calls[0].url).toBe('https://api.test/v1/checkout/preview');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ deliveryAddressId: 'a1', deliveryMethodId: 'z1' });
    expect([p.deliveryNeedsAddress, p.buyerCommissionMinor]).toEqual([false, '43542']);
  });

  it('orders.checkoutGroup(id) → GET orders/checkout-groups/:id (every order of the group)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'g1', totalMinor: '300', currencyCode: 'INR', createdAt: 'x', orders: [{ id: 'o1' }, { id: 'o2' }] } } }));
    const g = await client(fn).orders.checkoutGroup('g1');
    expect(calls[0].url).toBe('https://api.test/v1/orders/checkout-groups/g1');
    expect(hdr(calls[0]).authorization).toBe('Bearer tok');
    expect(g.orders).toHaveLength(2);
  });

  it('listings.getPublic → the allow-listed PublicListingDetail, anonymous (no bearer): organisation + district, no coordinates or seller person', async () => {
    const data: PublicListingDetail = { id: 'L1', title: 'Groundnut', description: null, categoryId: 'c', productId: 'p', grade: null, unitCode: 'quintal',
      priceMinor: '615000', currencyCode: 'INR', quantityAvailable: 34, minOrderQty: 5, harvestDate: '2026-07-08', organicClaim: 'natural', organic: true,
      saleType: 'direct', status: 'published', district: 'Junagadh', organisation: { slug: 'anand-fpo', name: 'Anand FPO' }, publishedAt: null,
      qrToken: null, auctionId: null, auctionStatus: null, auctionEndsAt: null };
    const { fn, calls } = fakeFetch(() => ({ body: { data } }));
    const l = await client(fn).listings.getPublic('L1');
    expect(hdr(calls[0]).authorization).toBeUndefined();
    expect(l.organisation?.name).toBe('Anand FPO');
    for (const k of ['lat', 'lng', 'pincode', 'regionId', 'tenantId', 'version', 'aiExtracted', 'sellerUserId']) expect(l).not.toHaveProperty(k);
  });

  it('listings.sellerPublic → organisation fields; the type has no person name / join date / region id', async () => {
    const data: SellerPublicProfile = { sellerId: 's1', organisation: { slug: 'anand-fpo', name: 'Anand FPO', district: 'Junagadh' }, rating: { count: 0, avgStars: 0 }, listingsActive: 2 };
    const { fn } = fakeFetch(() => ({ body: { data } }));
    const s = await client(fn).listings.sellerPublic('s1');
    expect(s.organisation).toEqual({ slug: 'anand-fpo', name: 'Anand FPO', district: 'Junagadh' });
    for (const k of ['displayName', 'memberSince', 'regionId']) expect(s).not.toHaveProperty(k);
  });

  it('storefront.flags carries the five tenant-scoped switches when an organisation is in context', async () => {
    const data: StorefrontFlags = { group_lots: true, org_self_signup: true, online_payments: false, buyer_charges: false, offers: false, auctions: false, reviews: false };
    const { fn } = fakeFetch(() => ({ body: { data } }));
    const f = await createClient({ baseUrl: 'https://api.test', tenantSlug: 'anand-fpo', fetchImpl: fn }).storefront.flags();
    expect([f.online_payments, f.buyer_charges, f.offers, f.auctions, f.reviews]).toEqual([false, false, false, false, false]);
  });

  it('cart.get carries the currency per line and for the cart (null when mixed) — never assumed', async () => {
    const data: Cart = { subtotalMinor: '0', currencyCode: null, items: [] };
    const { fn } = fakeFetch(() => ({ body: { data } }));
    expect((await client(fn).cart.get()).currencyCode).toBeNull();
  });
});
