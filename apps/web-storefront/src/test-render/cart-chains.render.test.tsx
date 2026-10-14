// apps/web-storefront/src/test-render/cart-chains.render.test.tsx · PC-56 STORE-2b · C2 / C4 / C8 — the cart's chains as real states of ONE page
// (the URL carries them; no client JS), and the Server Actions that lead there:
//   • W3041 form-error: THIS line re-rendered with the named refusal and the typed value kept; W3043 success: the line + a notice; W3044 failure:
//     named, the value kept (W3042 review = DELTA: no review page);
//   • W3045 confirm: Remove ("you can add it again"), Accept with BOTH numbers (the price the buyer saw rides as expectedPriceMinor);
//     W3046 success: removed / accepted notices; W3047 failure: the price changed AGAIN (the newest numbers), the line gone (its reason);
//   • the actions: a decimal STRING to the API, never a float; refusals mapped by name into the URL; the typed value kept.
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

import TenantCart from '../app/[tenantSlug]/cart/page';
import { updateCartLineAction, removeCartLineAction, acceptPriceAction } from '../app/[tenantSlug]/cart/actions';
import { en } from '../i18n/en';
import { renderResolved, text } from './store1b-harness';
import { W, reset, LINE, DRIFT, REASON, ID } from './store2b-fixtures';

const cart = async (searchParams: Record<string, string> = {}) => renderResolved(await TenantCart({ params: { tenantSlug: 'anand-fpo' }, searchParams }), []);
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const redirectOf = async (p: Promise<void>) => p.then(() => 'no redirect', (e: Error) => e.message.replace(/^REDIRECT /, ''));
const q = (href: string) => Object.fromEntries(new URL(`https://x${href}`).searchParams);
beforeEach(reset);

describe('STORE-2b · W3041–W3044 the quantity chain (one page, the URL carries the state)', () => {
  it('W3041 form-error: THIS line shows the named refusal (the minimum + unit), the typed value kept; the other lines untouched', async () => {
    W.cart = { items: [LINE(ID.ok), DRIFT], subtotalMinor: '8198000', currencyCode: 'INR' };
    const html = await cart({ step: 'error', line: ID.ok, err: 'below_min', qty: '3' });
    expect(html).toContain('data-kv-line-refusal="below_min"');
    expect(text(html)).toContain('The minimum order is 5 quintal — raise the quantity. Nothing was changed.');
    expect(html).toMatch(new RegExp(`id="q-${ID.ok}"[^>]*aria-invalid="true"[^>]*value="3"`));
    expect(html).toMatch(new RegExp(`id="q-${ID.drift}"[^>]*value="8"`));
    expect((html.match(/data-kv-line-refusal=/g) ?? []).length).toBe(1);
    // above available / not a number / another store's line / a gone listing — each by name
    for (const [err, sentence] of [['above_available', 'Only 34 quintal are available'], ['not_a_number', en['cart.refused.not_a_number']],
      ['suspended', en['cart.refused.suspended']], ['not_found', en['cart.refused.not_found']]]) {
      expect(text(await cart({ step: 'error', line: ID.ok, err, qty: 'x' }))).toContain(sentence);
    }
  });
  it('W3042 is a DELTA (no review page: the re-rendered cart is the review); W3043 success: the line + a notice, no audit claim', async () => {
    const html = await cart({ done: 'updated', line: ID.ok });
    expect(html).toContain('data-kv-notice="cart.done.updated"');
    expect(html).toContain('data-kv-line-notice="updated"');
    expect(text(html)).not.toMatch(/audit trail has the entry|zero-sum|Review before submitting/i);
  });
  it('W3044 failure: named ("didn\'t go through, nothing was changed"), the value kept; nothing pages the on-call', async () => {
    const html = await cart({ step: 'error', line: ID.ok, err: 'failed', qty: '12.5' });
    expect(text(html)).toContain(en['cart.refused.failed']);
    expect(html).toMatch(new RegExp(`id="q-${ID.ok}"[^>]*value="12.5"`));
    expect(text(html)).toContain(en['store2b.refusal.oncall']);
  });
  it('the action: a DECIMAL STRING to the API; the typed value checked first and kept on refusal; the API\'s refusal named', async () => {
    const base = { tenantSlug: 'anand-fpo', listingId: ID.ok, min: '5.000', available: '34.000' };
    expect(await redirectOf(updateCartLineAction(form({ ...base, quantity: '12.5' })))).toBe(`/anand-fpo/cart?done=updated&line=${ID.ok}#line-${ID.ok}`);
    expect(W.calls).toEqual([['updateItem', ID.ok, '12.5']]);
    const nan = await redirectOf(updateCartLineAction(form({ ...base, quantity: 'ten' })));
    expect(q(nan)).toEqual({ step: 'error', line: ID.ok, err: 'not_a_number', qty: 'ten' });
    expect(q(await redirectOf(updateCartLineAction(form({ ...base, quantity: '3' }))))).toMatchObject({ err: 'below_min', qty: '3' });
    expect(q(await redirectOf(updateCartLineAction(form({ ...base, quantity: '34.5' }))))).toMatchObject({ err: 'above_available' });
    expect(q(await redirectOf(updateCartLineAction(form({ ...base, quantity: '2.0001' }))))).toMatchObject({ err: 'not_a_number' });
    W.fail.updateItem = { code: 'LISTING_NOT_PURCHASABLE', details: { reason: 'suspended' } };
    expect(q(await redirectOf(updateCartLineAction(form({ ...base, quantity: '6' }))))).toMatchObject({ step: 'error', err: 'suspended', qty: '6' });
    W.fail.updateItem = { code: 'STOREFRONT_CART_OFF', status: 503 };
    expect(q(await redirectOf(updateCartLineAction(form({ ...base, quantity: '6' }))))).toMatchObject({ err: 'cart_off' });
    W.fail.updateItem = { code: 'SOMETHING_ELSE' };
    expect(q(await redirectOf(updateCartLineAction(form({ ...base, quantity: '6' }))))).toMatchObject({ err: 'failed' });
  });
});

describe('STORE-2b · W3045–W3047 Remove / Accept price / Resolve / Retry', () => {
  it('W3045 Remove → the confirm on THIS line ("you can add it again") with Cancel; Retry on an error = a reload (DECOR)', async () => {
    const html = await cart({ step: 'confirm', act: 'remove', line: ID.ok });
    expect(html).toContain('data-kv-confirm="remove"');
    expect(text(html)).toContain('Remove GG-20 Groundnut · Grade A from your cart? You can add it again from its listing.');
    expect(html).toContain(`href="/anand-fpo/cart#line-${ID.ok}" class="kv-btn--link" data-kv-cancel="remove"`);
    expect(html).not.toMatch(/audit-trail entry|audit trail/i);
  });
  it('W3045 Accept price → the confirm shows BOTH numbers; the price the buyer saw rides along as expectedPriceMinor', async () => {
    W.cart = { items: [DRIFT], subtotalMinor: '2048000', currencyCode: 'INR' };
    const html = await cart({ step: 'confirm', act: 'accept', line: ID.drift });
    expect(html).toContain('data-kv-confirm="accept"');
    expect(text(html)).toContain('You added it at ₹2,520.00; it is now ₹2,560.00 per quintal. Your order will be placed at ₹2,560.00.');
    expect(html).toContain('<input type="hidden" name="expectedPriceMinor" value="256000"/>');
  });
  it('W3046 success: removed / accepted (the line now at the new price — no drift box); W3047 failure: the price changed AGAIN / the line is gone', async () => {
    W.cart = { items: [LINE(ID.drift, { addedPriceMinor: '256000', currentPriceMinor: '256000', unitPriceMinor: '256000' })], subtotalMinor: '2560000', currencyCode: 'INR' };
    let html = await cart({ done: 'accepted', line: ID.drift });
    expect(text(html)).toContain(en['cart.done.accepted']);
    expect(html).not.toContain('data-kv-drift');
    expect(text(await cart({ done: 'removed' }))).toContain(en['cart.done.removed']);
    W.cart = { items: [{ ...DRIFT, addedPriceMinor: '252000', currentPriceMinor: '262000', priceDeltaMinor: '10000' }], subtotalMinor: '2096000', currencyCode: 'INR' };
    html = await cart({ step: 'failure', act: 'accept', line: ID.drift, err: 'price_changed' });
    expect(text(html)).toContain(en['cart.failure.priceAgain']);
    expect(html).toContain('data-kv-price="current">₹2,620.00</span>');      // the NEWEST two numbers
    W.cart = { items: [REASON(ID.paused, 'paused')], subtotalMinor: '0', currencyCode: null };
    html = await cart({ step: 'failure', act: 'remove', line: ID.paused, err: 'paused' });
    expect(html).toContain('data-kv-line-failure="paused"');
  });
  it('the actions: Remove / Accept call the API (Accept with the price shown) and land on the success or the named failure', async () => {
    const base = { tenantSlug: 'anand-fpo', listingId: ID.drift };
    expect(await redirectOf(removeCartLineAction(form(base)))).toBe('/anand-fpo/cart?done=removed');
    expect(await redirectOf(acceptPriceAction(form({ ...base, expectedPriceMinor: '256000' })))).toBe(`/anand-fpo/cart?done=accepted&line=${ID.drift}#line-${ID.drift}`);
    expect(W.calls).toEqual([['removeItem', ID.drift], ['acceptPrice', ID.drift, '256000']]);
    W.fail.acceptPrice = { code: 'PRICE_CHANGED', details: { addedPriceMinor: '252000', currentPriceMinor: '262000' } };
    expect(q(await redirectOf(acceptPriceAction(form({ ...base, expectedPriceMinor: '256000' }))))).toEqual({ step: 'failure', act: 'accept', line: ID.drift, err: 'price_changed' });
    W.fail.removeItem = { code: 'CART_NOT_FOUND', status: 404 };
    expect(q(await redirectOf(removeCartLineAction(form(base))))).toEqual({ step: 'failure', act: 'remove', line: ID.drift, err: 'failed' });
  });
  it('Resolve is navigation (an anchor to the first problem line), never a mutation', async () => {
    W.cart = { items: [LINE(ID.ok), REASON(ID.sold, 'sold_out')], subtotalMinor: '6150000', currencyCode: 'INR' };
    const html = await cart();
    expect(html).toContain(`href="#line-${ID.sold}" class="kv-btn" data-kv-resolve="1"`);
  });
});
