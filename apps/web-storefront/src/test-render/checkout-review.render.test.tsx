// apps/web-storefront/src/test-render/checkout-review.render.test.tsx · PC-56 STORE-2c · C4 — canon W285, review & place (rewritten from HOTFIX-4's
// platform review, whose logic moved under the organisation):
//   • one block per seller's order — "Order N of M — <organisation>" — its items with the prices as they will be frozen, its OWN bill rows (the
//     API's slice: delivery, platform fee, total) that SUM, and "paid on its own after you place it" (founder D2); the one-payment claim refused;
//   • the preview is asked with the SERVER-HELD address + method + coupon; placement sends ONLY the key minted at render (the choices come from
//     the server-held state, never the form);
//   • the GST sentence (D5), the quality window FROM THE API (hours), "payment is processed by {platform}" (D8), the snapshot sentence;
//   • the Place button locks (pending); the stock that shrank at placement → back here with the remainder and "reduce or remove" (no partial
//     take); mixed currencies named; a line problem → this store's cart; the W285 refusals by name.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SdkError } from '@krishalaya/sdk-js';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }) }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: jest.requireActual('./store2c-fixtures').C.pending === true }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: 'rzp_test_x' } }));
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
import { placeOrderAction } from '../app/[tenantSlug]/checkout/actions';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, A, Z, O } from './store2c-fixtures';
import { store2cRefusalKeys } from '../features/store2/refusals';

const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await TenantCheckout({ params: { tenantSlug: 'anand-fpo' }, searchParams: { step: 'review', ...sp } }));
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const redirectOf = async (p: Promise<void>) => p.then(() => 'no redirect', (e: Error) => e.message.replace(/^REDIRECT /, ''));
const KEY = '0209bb00-0000-7000-8000-000000000001';
beforeEach(() => reset());

describe('STORE-2c · W285 review & place', () => {
  it('one block per seller\'s order, each with its items, its own rows that sum, and paid on its own', async () => {
    const html = await page();
    expect(html).toContain('data-kv-seller-block="1"');
    expect(html).toContain('data-kv-seller-block="2"');
    expect(text(html)).toContain('Order 1 of 2 — Anand FPO');
    expect(text(html)).toContain('Order 2 of 2 — Anand FPO');
    expect((html.match(/data-kv-bill="sums"/g) ?? []).length).toBe(2);
    expect((html.match(/data-kv-paid-separately=""/g) ?? []).length).toBe(2);
    expect(text(html)).toMatch(/GG-20 Groundnut · Grade A · 10 quintal × ₹\s?6,150\.00/);
    expect(text(html)).toMatch(/All 2 orders together ₹\s?82,363\.75/);
    expect(text(html)).toContain(en['store2c.refusal.onePayment']);
  });
  it('the preview is asked with the SERVER-HELD address, method and coupon', async () => {
    C.state = { ...C.state, coupon: 'SAVE10' };
    await page();
    expect(C.calls.find((c) => c[0] === 'preview')![1]).toEqual({ deliveryAddressId: A.home, deliveryMethodId: Z.jun, couponCode: 'SAVE10' });
  });
  it('D5 GST sentence, the API\'s quality window, "processed by {platform}" (D8), the snapshot sentence (true: placement refuses a changed price)', async () => {
    const html = await page();
    expect(text(html)).toContain(en['bill.taxIncluded']);
    expect(en['bill.taxIncluded']).toBe('GST, where it applies, is included in the price and shown on your invoice.');
    expect(text(html)).toContain('After delivery you have 24 hours to raise a quality issue.');
    expect(en['store2c.review.qualityWindow']).not.toMatch(/[0-9]/);
    expect(text(html)).toContain('Payment is processed by Krishalaya.');
    expect(text(html)).toContain(en['store2c.review.snapshot']);
  });
  it('the Place button LOCKS while it runs; its key is minted at render; placement sends only the key — the choices come from the server-held state', async () => {
    C.pending = true;
    const html = await page();
    expect(html).toMatch(/<button type="submit" class="kv-btn" disabled="" aria-busy="true">Placing your order…<\/button>/);
    expect(html).toMatch(/name="idempotencyKey" value="[0-9a-f-]{36}"/);
    expect(html).not.toContain('name="deliveryAddressId"');
    C.created = { orders: [{ id: O.a, orderNo: 'KV-A', totalMinor: '6172875', status: 'payment_pending', paymentState: 'pending' }], checkoutGroupId: null };
    expect(await redirectOf(placeOrderAction(form({ slug: 'anand-fpo', idempotencyKey: KEY })))).toBe(`/anand-fpo/checkout/pay?o=${O.a}`);
    expect(C.calls.find((c) => c[0] === 'checkout')!.slice(1)).toEqual([{ deliveryAddressId: A.home, deliveryMethodId: Z.jun }, KEY]);
    expect(C.calls.some((c) => c[0] === 'clearCheckout')).toBe(true);
  });
  it('a two-seller placement → the confirmation naming both; paying from the wallet rides to the pay step', async () => {
    C.created = { orders: [{ id: O.a, paymentState: 'pending' }, { id: O.b, paymentState: 'pending' }], checkoutGroupId: 'g1' };
    expect(await redirectOf(placeOrderAction(form({ slug: 'anand-fpo', idempotencyKey: KEY })))).toBe('/anand-fpo/checkout/confirm?g=g1');
    C.state = { ...C.state, pay: 'wallet' };
    C.created = { orders: [{ id: O.a, paymentState: 'pending' }], checkoutGroupId: null };
    expect(await redirectOf(placeOrderAction(form({ slug: 'anand-fpo', idempotencyKey: KEY })))).toBe(`/anand-fpo/checkout/pay?o=${O.a}&via=wallet`);
  });
  it('the stock shrank under the lock → back at review with the remainder; "reduce or remove"; the partial take refused by name', async () => {
    C.fail.checkout = { code: 'LISTING_INSUFFICIENT_STOCK', details: { listingId: 'l-s1', requested: '10.000', available: '4.000' } };
    const r = await redirectOf(placeOrderAction(form({ slug: 'anand-fpo', idempotencyKey: KEY })));
    expect(r).toBe('/anand-fpo/checkout?step=review&status=stock&available=4.000&listing=l-s1');
    const html = await page({ status: 'stock', available: '4.000' });
    expect(html).toContain('data-kv-refused="stock"');
    expect(text(html)).toContain('Only 4.000 remain of an item you chose — nothing was placed. Reduce it to 4.000 or remove it');
    expect(text(html)).toContain(en['store2c.refusal.partialTake']);
    expect(text(html)).not.toMatch(/take 4/i);
  });
  it('MIXED_CURRENCY named at the preview (no Place button) and at placement', async () => {
    C.preview = new SdkError('MIXED_CURRENCY', 422, 'x', undefined, { currencies: ['INR', 'USD'] });
    const html = await page();
    expect(html).toContain('data-kv-refused="mixed_currency"');
    expect(html).not.toContain('Place order</button>');
    reset();
    C.fail.checkout = { code: 'MIXED_CURRENCY', status: 422 };
    expect(await redirectOf(placeOrderAction(form({ slug: 'anand-fpo', idempotencyKey: KEY })))).toBe('/anand-fpo/checkout?step=review&status=mixed_currency');
  });
  it('a line problem (a price changed) → this store\'s cart with the refusal named; a ban stays here with the region', async () => {
    C.fail.checkout = { code: 'PRICE_CHANGED', details: { addedPriceMinor: '1', currentPriceMinor: '2' } };
    expect(await redirectOf(placeOrderAction(form({ slug: 'anand-fpo', idempotencyKey: KEY })))).toBe('/anand-fpo/cart?status=price_changed');
    C.fail.checkout = { code: 'BANNED_IN_REGION', status: 422, details: { region: 'Maharashtra' } };
    expect(await redirectOf(placeOrderAction(form({ slug: 'anand-fpo', idempotencyKey: KEY })))).toBe('/anand-fpo/checkout?step=review&status=banned&region=Maharashtra');
  });
  it('nothing left to check out → said (W285 "No items left"), with this store to browse', async () => {
    C.cart = { items: [], subtotalMinor: '0', currencyCode: null };
    const html = await page();
    expect(html).toContain('data-kv-state="empty"');
    expect(text(html)).toContain(en['store2c.noItems']);
  });
  it('the W285 refusals by name; no HSN, no GST rate, no "slots held"', async () => {
    const html = await page();
    for (const k of store2cRefusalKeys('checkout-review')) expect([k, text(html).includes(en[k as keyof typeof en])]).toEqual([k, true]);
    expect(text(html)).not.toMatch(/HSN \d|18% =|0% GST|30-minute|held for/i);
  });
});
