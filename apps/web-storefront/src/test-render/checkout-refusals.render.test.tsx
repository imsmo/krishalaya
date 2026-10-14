// apps/web-storefront/src/test-render/checkout-refusals.render.test.tsx · PC-56 STORE-2b · C6 — checkout (a platform route this wave; nothing
// else changes — STORE-2c moves it) maps the cart's refusals BY NAME and gets the two F-19 fixes:
//   • the preview's refusal: BANNED_IN_REGION names the region; a line problem (PRICE_CHANGED, BELOW_MIN_ORDER, …) sends the buyer back to the
//     cart; the Place button is withheld while the preview refuses; buying paused (the API's named 503) is said, platform-wide;
//   • placement's refusal: a line problem → `/cart?status=…` (the cart shows both numbers / the minimum), a ban → here with the region;
//   • the Place button LOCKS while the action runs (SubmitButton); a load error gets Retry (a reload).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SdkError } from '@krishalaya/sdk-js';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: true }) }));
jest.mock('../lib/i18n', () => {
  const { Translator: T } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  return { getLang: () => 'en', getTranslator: () => new T('en').register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ requireSession: async () => 'tok' }));
const M: { cart: unknown; preview: unknown; place: unknown } = { cart: null, preview: null, place: null };
const boom = (v: unknown) => { if (v instanceof Error) throw v; return v; };
jest.mock('../lib/api-client', () => ({
  serverClient: () => ({
    cart: { get: async () => boom(M.cart) },
    addresses: { list: async () => [{ id: 'a-home', line1: 'Home', pincode: '411037', isDefault: true }] },
    checkout: {
      deliveryMethods: async () => ({ currencyCode: 'INR', subtotalMinor: '1845000', methods: [] }),
      preview: async () => boom(M.preview),
      checkout: async () => boom(M.place),
    },
  }),
}));

import CheckoutPage from '../app/(platform)/checkout/page';
import { placeOrderAction } from '../app/(platform)/checkout/actions';
import { en } from '../i18n/en';
import { text } from './store1b-harness';

const PREVIEW = { currencyCode: 'INR', sellers: [], subtotalMinor: '1845000', deliveryFeeMinor: '0', platformFeeMinor: '0', discountMinor: '0',
  buyerCommissionMinor: '0', deliveryNeedsAddress: false, grandTotalMinor: '1845000', couponCode: null };
const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await CheckoutPage({ searchParams: sp }));
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const redirectOf = async (p: Promise<void>) => p.then(() => 'no redirect', (e: Error) => e.message.replace(/^REDIRECT /, ''));
beforeEach(() => { M.cart = { items: [{ listingId: 'l1' }], subtotalMinor: '1845000', currencyCode: 'INR' }; M.preview = PREVIEW; M.place = null; });

describe('STORE-2b · checkout maps the cart refusals by name (C6)', () => {
  it('the Place button is the pending-lock SubmitButton (disabled + "Placing your order…" while the action runs)', async () => {
    const html = await page();
    expect(html).toMatch(/<button type="submit" class="kv-btn" disabled="" aria-busy="true">Placing your order…<\/button>/);
  });
  it('a load error → said with Retry (a reload of this URL); buying paused → said, platform-wide', async () => {
    M.cart = new SdkError('UNAVAILABLE', 503, 'down');
    let html = await page({ addr: 'a-home' });
    expect(html).toContain('href="/checkout?addr=a-home" class="kv-btn" data-kv-retry="reload"');
    M.cart = new SdkError('STOREFRONT_CART_OFF', 503, 'paused');
    html = await page();
    expect(html).toContain('data-kv-state="cart-off"');
    expect(text(html)).toContain(en['store2b.refusal.flagTenantPlan']);
  });
  it('the preview refuses BANNED_IN_REGION → the region named, no Place button; a line problem → back to the cart, no Place button', async () => {
    M.preview = new SdkError('BANNED_IN_REGION', 422, 'banned', undefined, { listingId: 'l1', region: 'Maharashtra' });
    let html = await page();
    expect(text(html)).toContain('This product’s sale is banned in Maharashtra, where your delivery address is');
    expect(html).not.toContain('type="submit" class="kv-btn" disabled');
    M.preview = new SdkError('PRICE_CHANGED', 409, 'changed', undefined, { addedPriceMinor: '252000', currentPriceMinor: '256000' });
    html = await page();
    expect(html).toContain('data-kv-checkout-refusal="price_changed"');
    expect(text(html)).toContain(en['checkout.resolveInCart']);
    expect(html).not.toContain('Placing your order');
  });
  it('placement: PRICE_CHANGED / BELOW_MIN_ORDER / LICENCE_REQUIRED / a suspended line → back to the cart by name; a ban → here with the region; paused → said', async () => {
    const cases: Array<[SdkError, string]> = [
      [new SdkError('PRICE_CHANGED', 409, 'x', undefined, { addedPriceMinor: '1', currentPriceMinor: '2' }), '/cart?status=price_changed'],
      [new SdkError('BELOW_MIN_ORDER', 422, 'x', undefined, { minOrderQty: '5.000', unitCode: 'quintal' }), '/cart?status=below_min'],
      [new SdkError('LICENCE_REQUIRED', 422, 'x', undefined, {}), '/cart?status=licence'],
      [new SdkError('LISTING_NOT_PURCHASABLE', 409, 'x', undefined, { reason: 'suspended' }), '/cart?status=suspended'],
      [new SdkError('BANNED_IN_REGION', 422, 'x', undefined, { region: 'Maharashtra' }), '/checkout?status=banned&region=Maharashtra'],
      [new SdkError('STOREFRONT_CART_OFF', 503, 'x'), '/checkout?status=cart_off'],
      [new SdkError('UNSERVICEABLE_PINCODE', 422, 'x'), '/checkout?status=unserviceable'],
      [new SdkError('SOMETHING', 500, 'x'), '/checkout?status=err'],
    ];
    for (const [err, href] of cases) {
      M.place = err;
      expect([err.code, await redirectOf(placeOrderAction(form({ idempotencyKey: 'k1' })))]).toEqual([err.code, href]);
    }
    expect(text(await page({ status: 'banned', region: 'Maharashtra' }))).toContain('banned in Maharashtra');
  });
});
