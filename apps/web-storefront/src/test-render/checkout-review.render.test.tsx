// apps/web-storefront/src/test-render/checkout-review.render.test.tsx · PC-56 HOTFIX-4 · C3 (survey F-5a/b/c) — the checkout review quotes
// what placement charges: the delivery options are quoted for the address the buyer CHOSE (not the default), the preview is asked WITH that
// address and option, both ride into the place-order form, and the bill prints the buyer commission as its own row (rows that sum).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const calls: { methods: unknown[]; preview: unknown[] } = { methods: [], preview: [] };
const mock: { preview: Record<string, unknown> | null } = { preview: null };

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
// PC-56 STORE-2b · C6: the Place button is the pending-lock SubmitButton — `useFormStatus` (Next's React canary) as the login test fakes it
jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: false }) }));
jest.mock('../lib/i18n', () => {
  const { Translator: T } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  return { getLang: () => 'en', getTranslator: () => new T('en').register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ requireSession: async () => 'tok' }));
jest.mock('../app/(platform)/checkout/actions', () => ({ placeOrderAction: async () => undefined }));
jest.mock('../lib/api-client', () => ({
  serverClient: () => ({
    cart: { get: async () => ({ items: [{ listingId: 'l1' }], subtotalMinor: '1845000', currencyCode: 'INR' }) },
    addresses: { list: async () => [
      { id: 'a-home', line1: 'Home', pincode: '380001', isDefault: true },
      { id: 'a-shop', line1: 'Shop', pincode: '362001', isDefault: false },
    ] },
    checkout: {
      deliveryMethods: async (q: unknown) => { calls.methods.push(q); return { currencyCode: 'INR', subtotalMinor: '1845000', methods: [{ id: 'z-jun', name: 'Junagadh zone', feeMinor: '7500' }] }; },
      preview: async (q: unknown) => { calls.preview.push(q); return mock.preview; },
    },
  }),
}));

import CheckoutPage from '../app/(platform)/checkout/page';
import { en } from '../i18n/en';
import { text } from './store1b-harness';

const PREVIEW = { currencyCode: 'INR', sellers: [], subtotalMinor: '1845000', deliveryFeeMinor: '7500', platformFeeMinor: '46125', discountMinor: '0',
  buyerCommissionMinor: '43542', deliveryNeedsAddress: false, grandTotalMinor: '1942167', couponCode: null };

beforeEach(() => { calls.methods = []; calls.preview = []; mock.preview = PREVIEW; });

describe('HOTFIX-4 · the checkout review quotes the CHOSEN address', () => {
  it('?addr= → options quoted for THAT pincode; the preview asked WITH the address and the option; both carried into placement', async () => {
    const html = renderToStaticMarkup(await CheckoutPage({ searchParams: { addr: 'a-shop' } }));
    expect(calls.methods).toEqual([{ pincode: '362001' }]);
    expect(calls.preview).toEqual([{ deliveryAddressId: 'a-shop', deliveryMethodId: 'z-jun' }]);
    expect(html).toContain('<input type="hidden" name="deliveryAddressId" value="a-shop"/>');
    expect(html).toContain('<input type="hidden" name="deliveryMethodId" value="z-jun"/>');
  });
  it('no choice → the default address, still quoted and previewed with it (never without an address)', async () => {
    await CheckoutPage({ searchParams: {} });
    expect(calls.preview).toEqual([{ deliveryAddressId: 'a-home', deliveryMethodId: 'z-jun' }]);
  });
  it('the bill: platform fee and buyer commission as their own rows; the rows sum; no "price includes platform fee"', async () => {
    const html = renderToStaticMarkup(await CheckoutPage({ searchParams: {} }));
    expect(html).toContain('data-kv-row="platformFee"');
    expect(html).toContain('data-kv-row="buyerCommission"');
    expect(html).toContain('data-kv-bill="sums"');
    expect(text(html)).toMatch(/19,421\.67/);
    expect(text(html)).not.toMatch(/includes? (the )?platform fee/i);
  });
  it('a zone store before an address: delivery says "choose your address", never a 0 as if free', async () => {
    mock.preview = { ...PREVIEW, deliveryFeeMinor: '0', deliveryNeedsAddress: true, grandTotalMinor: '1934667' };
    const html = renderToStaticMarkup(await CheckoutPage({ searchParams: {} }));
    expect(text(html)).toContain(en['bill.deliveryPending']);
  });
});
