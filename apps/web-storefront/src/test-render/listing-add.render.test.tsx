// apps/web-storefront/src/test-render/listing-add.render.test.tsx · PC-56 STORE-2b · C3 / C8 — the add-to-cart chain on W277 (W3099–W3102): every
// refusal NAMED above the field with the typed quantity kept (below the minimum, above available, not a number, LICENCE_REQUIRED, WRONG_STORE
// with the other store's sign-in link, a suspended seller, sold out, buying paused, a failure) — never "check your entry"; the button says
// "Add N <unit> to cart" (no line total); success → "View cart" → THIS store's cart; an anonymous visitor is told a cart needs a sign-in; the
// action sends a DECIMAL STRING and maps the API's refusal into the URL.
import * as React from 'react';

jest.mock('next/navigation', () => ({ ...jest.requireActual('next/navigation'), notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store2a-fixtures');
  return { getLang: () => f.S.lang, getTranslator: () => new Tr(f.S.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
const auth = { signedIn: true };
jest.mock('../lib/auth', () => ({ hasSessionCookie: () => auth.signedIn }));
jest.mock('../lib/session', () => ({ requireSession: async () => 'tok' }));
jest.mock('../lib/api-client', () => ({
  publicClient: () => jest.requireActual('./store2a-fixtures').apiClient(),
  serverClient: () => jest.requireActual('./store2b-fixtures').serverClient(),
  sessionTenantClient: () => jest.requireActual('./store2b-fixtures').sessionTenantClient(),
}));

import ListingDetail from '../app/[tenantSlug]/listings/[id]/page';
import { addToCartAction } from '../app/[tenantSlug]/listings/[id]/actions';
import { en } from '../i18n/en';
import { renderResolved, text } from './store1b-harness';
import { S, reset as resetA, L1 } from './store2a-fixtures';
import { W, reset as resetB } from './store2b-fixtures';

const lot = async (sp: Record<string, string> = {}) => renderResolved(await ListingDetail({ params: { tenantSlug: 'anand-fpo', id: L1 }, searchParams: sp }), []);
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const redirectOf = async (p: Promise<void>) => p.then(() => 'no redirect', (e: Error) => e.message.replace(/^REDIRECT /, ''));
const q = (href: string) => Object.fromEntries(new URL(`https://x${href.replace(/#.*$/, '')}`).searchParams);
beforeEach(() => { resetA(); resetB(); auth.signedIn = true; });

describe('STORE-2b · W3099–W3102 add to cart on the listing', () => {
  it('the field starts at the MINIMUM (5) and the button says "Add 5 quintal to cart" — no line total; the minimum rides as a hidden field', async () => {
    const html = await lot();
    expect(html).toMatch(/id="qty-cart"[^>]*inputMode="decimal"[^>]*value="5"/);
    expect(text(html)).toContain('Add 5 quintal to cart');
    expect(html).toContain('<input type="hidden" name="min" value="5"/>');
    expect(html).not.toMatch(/data-kv-add="cart">[^<]*₹/);                              // no client-computed total on the button
  });

  it('W3099 / W3102: every refusal named above the field, the typed quantity KEPT — never "check your entry"', async () => {
    const cases: Array<[string, string]> = [
      ['below_min', 'The minimum order is 5 quintal — raise the quantity.'],
      ['above_available', 'Only 34 quintal are available'],
      ['not_a_number', en['cart.refused.not_a_number']],
      ['licence', en['cart.refused.licence']],
      ['suspended', en['cart.refused.suspended']],
      ['sold_out', en['cart.refused.sold_out']],
      ['cart_off', en['cart.refused.cart_off']],
      ['failed', en['cart.refused.failed']],
    ];
    for (const [refusal, sentence] of cases) {
      const html = await lot({ step: 'error', refusal, qty: '3' });
      expect([refusal, html.includes(`data-kv-add-refusal="${refusal}"`)]).toEqual([refusal, true]);
      expect([refusal, text(html).includes(sentence)]).toEqual([refusal, true]);
      expect(html).toMatch(/id="qty-cart"[^>]*value="3"/);
      expect(text(html)).not.toContain(en['listing.statusError']);
    }
  });

  it('WRONG_STORE: "you are signed in to <A>; sign in to <B> to buy here" + THIS store\'s sign-in link back to this lot', async () => {
    const html = await lot({ step: 'error', refusal: 'wrong_store', qty: '6' });
    expect(text(html)).toContain('You are signed in to Kisan Sathi FPC; sign in to Anand FPO to buy here.');
    expect(html).toContain(`href="/anand-fpo/login?next=%2Fanand-fpo%2Flistings%2F${L1}" class="kv-link" data-kv-signin="store"`);
    W.home = new Error('down');
    expect(text(await lot({ step: 'error', refusal: 'wrong_store', qty: '6' }))).toContain(en['cart.refused.wrong_storeUnknown'].replace('{store}', 'Anand FPO'));
  });

  it('W3101 success: "Added" + "View cart" → THIS store\'s cart (never the platform /cart); W3100 review is a DELTA (no review page)', async () => {
    const html = await lot({ status: 'added' });
    expect(text(html)).toContain(en['listing.statusAdded']);
    expect(html).toMatch(/href="\/anand-fpo\/cart"[^>]*data-kv-view-cart="store"|data-kv-view-cart="store"[^>]*href="\/anand-fpo\/cart"/);
    expect(text(html)).not.toMatch(/Review before submitting|audit trail has the entry/i);
  });

  it('an anonymous visitor is told a cart needs a sign-in to this store (no guest cart); the licence-upload chain is refused on the page', async () => {
    auth.signedIn = false;
    const html = await lot();
    expect(html).toContain('data-kv-signin-note="cart"');
    expect(text(html)).toContain(en['listing.signinToBuy']);
    expect(text(html)).toContain(en['store2b.refusal.licenceUpload']);
  });

  it('the action: the DECIMAL STRING goes to the API; refusals are mapped by name with the typed value kept; success → ?status=added', async () => {
    const base = { tenantSlug: 'anand-fpo', listingId: L1, min: '5', available: '34' };
    expect(await redirectOf(addToCartAction(form({ ...base, quantity: '5.5' })))).toBe(`/anand-fpo/listings/${L1}?status=added`);
    expect(W.calls).toEqual([['addItem', L1, '5.5']]);
    expect(q(await redirectOf(addToCartAction(form({ ...base, quantity: '3' }))))).toEqual({ step: 'error', refusal: 'below_min', qty: '3' });
    expect(q(await redirectOf(addToCartAction(form({ ...base, quantity: 'lots' }))))).toEqual({ step: 'error', refusal: 'not_a_number', qty: 'lots' });
    for (const [code, details, refusal] of [['LICENCE_REQUIRED', {}, 'licence'], ['WRONG_STORE', { listingTenantSlug: 'anand-fpo' }, 'wrong_store'],
      ['LISTING_NOT_PURCHASABLE', { reason: 'suspended' }, 'suspended'], ['BELOW_MIN_ORDER', { minOrderQty: '6.000' }, 'below_min'],
      ['STOREFRONT_CART_OFF', {}, 'cart_off']] as const) {
      W.fail.addItem = { code, details };
      expect([code, q(await redirectOf(addToCartAction(form({ ...base, quantity: '6' })))).refusal]).toEqual([code, refusal]);
    }
  });

  it('the default quantity is 1 when the lot has no minimum', async () => {
    S.detail = { ...S.detail, minOrderQty: 0 };
    expect(text(await lot())).toContain('Add 1 quintal to cart');
  });
});
