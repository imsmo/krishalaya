// apps/web-storefront/src/test-render/cart.render.test.tsx · PC-56 STORE-2b · C1 / C8 — canon W281 at /[tenantSlug]/cart: the organisation named
// in the H1 (never "you have 1 more cart"); a changed price with BOTH numbers and the server's delta + Accept / Remove (each a confirm link); a
// line that cannot be bought says WHY by name; a line below its minimum says the minimum; "Resolve N items" replaces the checkout link while
// anything blocks; the summary is the items subtotal only; empty → THIS store's browse; error ≠ empty with Retry; buying paused (the flag or
// the API's named refusal); sign-in required (no guest cart); signed in to ANOTHER store; no person's name; every §E refusal printed.
import * as React from 'react';

jest.mock('next/navigation', () => ({ ...jest.requireActual('next/navigation'), notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
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
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('../app/[tenantSlug]/cart/actions', () => ({ updateCartLineAction: async () => undefined, removeCartLineAction: async () => undefined, acceptPriceAction: async () => undefined }));

import TenantCart from '../app/[tenantSlug]/cart/page';
import { en } from '../i18n/en';
import { store2bRefusalKeys } from '../features/store2/refusals';
import { renderResolved, text } from './store1b-harness';
import { W, reset, LINE, DRIFT, REASON, ID, T_OTHER } from './store2b-fixtures';

const cart = async (searchParams: Record<string, string> = {}) => renderResolved(await TenantCart({ params: { tenantSlug: 'anand-fpo' }, searchParams }), []);
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_m, k) => v[k] ?? `{${k}}`);
beforeEach(reset);

describe('STORE-2b · W281 the cart (/[tenantSlug]/cart)', () => {
  it('the H1 names the organisation; a line: photo, title → the listing, "<org> · <district> · min order · available", quantity + Update, Remove (a confirm)', async () => {
    const html = await cart();
    expect(text(html)).toContain('Your cart — Anand FPO');
    expect(html).toContain('src="https://cdn.test/gg20.jpg"');
    expect(html).toContain(`href="/anand-fpo/listings/${ID.ok}" class="kv-cart__title"`);
    expect(text(html)).toContain('Anand FPO · Junagadh · min order 5 quintal · 34 quintal available');
    expect(html).toMatch(new RegExp(`id="q-${ID.ok}"[^>]*value="10"`));
    expect(html).toContain(`href="/anand-fpo/cart?step=confirm&amp;act=remove&amp;line=${ID.ok}#line-${ID.ok}"`);
    expect(text(html)).not.toMatch(/1 more|Kisan Sathi/);                            // one store per session (founder D3)
  });

  it('a changed price: BOTH numbers and the server delta, Accept (with the new price) and Remove — each a confirm step', async () => {
    W.cart = { items: [DRIFT], subtotalMinor: '2048000', currencyCode: 'INR' };
    const html = await cart();
    expect(html).toContain(`data-kv-drift="${ID.drift}"`);
    expect(html).toMatch(/data-kv-price="added">₹2,520\.00<\/span> <span class="kv-dir-flip">→<\/span>/);
    expect(html).toContain('data-kv-price="current">₹2,560.00</span>');
    expect(html).toContain('data-kv-price="delta">+₹40.00</span>');
    expect(text(html)).toContain(en['cart.drift.body']);
    expect(html).toContain(`href="/anand-fpo/cart?step=confirm&amp;act=accept&amp;line=${ID.drift}#line-${ID.drift}"`);
    expect(text(html)).toContain('Accept ₹2,560.00 per quintal');
    expect(html).toMatch(/data-kv-act="remove"/);
    // a price that went DOWN says so with a minus sign, from the server's delta (the page never subtracts)
    W.cart = { items: [{ ...DRIFT, currentPriceMinor: '250000', priceDeltaMinor: '-2000' }], subtotalMinor: '2000000', currencyCode: 'INR' };
    expect(await cart()).toContain('data-kv-price="delta">−₹20.00</span>');
  });

  it('a line that cannot be bought says WHY by name (sold out · paused · expired · withdrawn · suspended · licence · gone) + Remove; no quantity field', async () => {
    const reasons = ['sold_out', 'paused', 'expired', 'withdrawn', 'suspended', 'licence_required', 'not_found'];
    W.cart = { items: reasons.map((r, i) => REASON(`0208c000-0000-7000-8000-00000000000${i}`, r)), subtotalMinor: '0', currencyCode: null };
    const html = await cart();
    for (const r of reasons) {
      expect(html).toContain(`data-kv-line-reason="${r}"`);
      expect(text(html)).toContain(en[`cart.reason.${r}`]);
    }
    expect(text(html)).toContain('Sold out — the organisation says so');
    expect(text(html)).toContain('a buyer licence flow does not exist yet');
    expect(html).not.toContain('data-kv-form="quantity"');
    expect(html).not.toMatch(/Upload renewal|upload yours once/i);                     // founder D1: no licence upload form
  });

  it('below the minimum names the minimum; above available names what is available', async () => {
    W.cart = { items: [LINE(ID.below, { quantityDecimal: '3.000', quantity: 3, belowMin: true }), LINE(ID.ok, { quantityDecimal: '40.000', overAvailable: true })], subtotalMinor: '0', currencyCode: 'INR' };
    const html = await cart();
    expect(text(html)).toContain('Below the minimum order of 5 quintal');
    expect(text(html)).toContain('Only 34 quintal are available');
  });

  it('"Resolve N items to continue" replaces the checkout link while anything blocks (an anchor to the first problem line); none → checkout', async () => {
    W.cart = { items: [LINE(ID.ok), DRIFT, REASON(ID.sold, 'sold_out')], subtotalMinor: '8198000', currencyCode: 'INR' };
    let html = await cart();
    expect(html).toContain(`href="#line-${ID.drift}" class="kv-btn" data-kv-resolve="2"`);
    expect(text(html)).toContain('Resolve 2 item(s) to continue');
    expect(html).not.toContain('data-kv-checkout="go"');
    reset();
    html = await cart();
    expect(html).toMatch(/<a class="kv-btn" data-kv-checkout="go" href="\/checkout">/);
    expect(html).not.toContain('data-kv-resolve');
  });

  it('the summary is the items subtotal ONLY + "quoted at checkout"; no delivery estimate, slab, GST or "3 steps" claim; "never charges" kept', async () => {
    const html = await cart();
    const visible = text(html.replace(/<section class="kv-refused"[\s\S]*<\/section>/, ''));
    expect(visible).toContain('Items subtotal ₹61,500.00');
    expect(visible).toContain(en['cart.quotedAtCheckout']);
    expect(visible).toContain(en['cart.neverCharges']);
    expect(visible).not.toMatch(/\/qtl\/100km|₹50|slabs|₹450|18% GST|include GST|Estimated total|3 steps|shipments/i);
  });

  it('empty → THIS store\'s browse (never "/"); error ≠ empty with Retry = a reload; buying paused by the flag OR the API\'s named refusal', async () => {
    W.cart = { items: [], subtotalMinor: '0', currencyCode: null };
    let html = await cart();
    expect(html).toContain('href="/anand-fpo" class="kv-btn" data-kv-browse="store"');
    expect(text(html)).toContain('Your cart at Anand FPO is empty.');
    reset(); W.cart = new Error('down');
    html = await cart({ step: 'confirm' });
    expect(html).toContain('data-kv-state="error"');
    expect(html).toContain('href="/anand-fpo/cart?step=confirm" class="kv-btn" data-kv-retry="reload"');
    expect(html).not.toContain('data-kv-state="empty"');
    expect(text(html)).not.toMatch(/saved on this phone — nothing is lost/i);
    reset(); W.flags = { ...W.flags, storefront_cart: false };
    html = await cart();
    expect(html).toContain('data-kv-state="cart-off"');
    expect(text(html)).toContain(en['store2b.cartOff.title']);
    reset(); W.cart = 'OFF';
    expect(await cart()).toContain('data-kv-state="cart-off"');
  });

  it('sign-in required (no guest cart): the sentence + THIS store\'s sign-in; signed in to ANOTHER store: the sentence + both doors', async () => {
    W.token = null;
    let html = await cart();
    expect(html).toContain('data-kv-state="signin"');
    expect(html).toContain('href="/anand-fpo/login?next=%2Fanand-fpo%2Fcart"');
    expect(text(html)).toContain(fill(en['cart.signinRequired'], { org: 'Anand FPO' }));
    reset(); W.sessionTenant = T_OTHER;
    html = await cart();
    expect(html).toContain('data-kv-state="wrong-store"');
    expect(text(html)).toContain('You are signed in to Kisan Sathi FPC. Sign in to Anand FPO to buy here');
    expect(html).toContain('href="/kisan-sathi/cart"');
    expect(html).toContain('data-kv-signin="store"');
  });

  it('no person on any line — the organisation sells; every §E refusal of the cart printed by name', async () => {
    W.cart = { items: [LINE(ID.ok), DRIFT, REASON(ID.susp, 'suspended')], subtotalMinor: '8198000', currencyCode: 'INR' };
    const html = await cart();
    expect(html).not.toMatch(/Ramesh|Patel|Meera|member #|sellerUserId/);
    for (const k of store2bRefusalKeys('cart')) expect(text(html)).toContain(en[k]);
    expect(html).toContain('data-kv-refusal="more_carts"');
    expect(html).toContain('data-kv-refusal="licence_upload"');
  });

  it('back from checkout: the order was not placed, and why (a price changed / a minimum / a line)', async () => {
    W.cart = { items: [DRIFT], subtotalMinor: '2048000', currencyCode: 'INR' };
    const html = await cart({ status: 'price_changed' });
    expect(html).toContain('data-kv-status="price_changed"');
    expect(text(html)).toContain(`${en['cart.fromCheckout']} ${en['cart.status.price']}`);
  });
});
