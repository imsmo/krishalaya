// apps/web-storefront/src/test/store2b-cart.spec.ts · PC-56 STORE-2b · C8 (pure) — the cart's pure half: every API refusal code → ONE named refusal
// with a catalogue key (exhaustive over the SDK's CART_REFUSAL_CODES and every line reason); quantities as decimal strings to 3 places and the
// minimum, never a float; both prices and the delta formatted with the currency's OWN exponent (the server's delta — never a subtraction
// here); the resolve logic; the chain in the URL; the STORE-2b registries (16 canon files, the licence chain REFUSED citing D1).
import { readFileSync } from 'node:fs';
import { CART_REFUSAL_CODES } from '@krishalaya/sdk-js';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  CART_REFUSALS, cartChain, cartHref, checkQuantity, checkoutRefusalHref, driftView, lineProblems, milli, qtyText, readRefusal, refusalKey,
  refusalOf, resolveState,
} from '../features/store2b/cart';
import { STORE2B_CHAIN_PAGES, STORE2B_DELTAS, STORE2B_REFUSALS, store2bRefusalKeys } from '../features/store2/refusals';

const LINE = (over: Record<string, unknown> = {}) => ({
  listingId: 'l1', title: 'x', quantity: 1, unitPriceMinor: '1', lineTotalMinor: '1', priceChanged: false, available: 1, purchasable: true, reason: null, ...over,
}) as never;

describe('STORE-2b · cart refusals: code → one named refusal → a key in every catalogue', () => {
  it('every SDK refusal code maps to a NAMED refusal (never the generic failure)', () => {
    for (const code of CART_REFUSAL_CODES) expect([code, refusalOf(code, { reason: 'paused' })]).not.toEqual([code, 'failed']);
    expect(refusalOf('BELOW_MIN_ORDER')).toBe('below_min');
    expect(refusalOf('LISTING_INSUFFICIENT_STOCK')).toBe('above_available');
    expect(refusalOf('LICENCE_REQUIRED')).toBe('licence');
    expect(refusalOf('WRONG_STORE')).toBe('wrong_store');
    expect(refusalOf('PRICE_CHANGED')).toBe('price_changed');
    expect(refusalOf('BANNED_IN_REGION')).toBe('banned');
    expect(refusalOf('STOREFRONT_CART_OFF')).toBe('cart_off');
    expect(refusalOf('VALIDATION_FAILED')).toBe('not_a_number');
    expect([refusalOf('X'), refusalOf(null), refusalOf(undefined)]).toEqual(['failed', 'failed', 'failed']);
  });
  it('every line reason (LISTING_NOT_PURCHASABLE {reason}) maps by name; an unknown reason is "gone", never a guess', () => {
    const map = { suspended: 'suspended', sold_out: 'sold_out', paused: 'paused', expired: 'expired', withdrawn: 'withdrawn', not_found: 'not_found', licence_required: 'licence' };
    for (const [reason, r] of Object.entries(map)) expect(refusalOf('LISTING_NOT_PURCHASABLE', { reason })).toBe(r);
    expect(refusalOf('LISTING_NOT_PURCHASABLE', {})).toBe('not_found');
  });
  it('every refusal has its key in en / hi / gu; every line reason has its sentence; a hand-edited URL value is the named failure', () => {
    for (const r of CART_REFUSALS) for (const cat of [en, hi, gu]) expect([r, typeof cat[refusalKey(r)]]).toEqual([r, 'string']);
    for (const reason of ['sold_out', 'paused', 'expired', 'withdrawn', 'suspended', 'licence_required', 'not_found']) {
      for (const cat of [en, hi, gu]) expect(typeof cat[`cart.reason.${reason}`]).toBe('string');
    }
    expect([readRefusal('below_min'), readRefusal('<script>'), readRefusal(''), readRefusal(undefined)]).toEqual(['below_min', 'failed', null, null]);
  });
  it('checkout: a line problem → back to the cart; a ban → checkout with the region; paused → checkout; the rest → none', () => {
    expect(checkoutRefusalHref('price_changed')).toBe('/cart?status=price_changed');
    expect(checkoutRefusalHref('suspended')).toBe('/cart?status=suspended');
    expect(checkoutRefusalHref('banned', { region: 'Maharashtra' })).toBe('/checkout?status=banned&region=Maharashtra');
    expect(checkoutRefusalHref('cart_off')).toBe('/checkout?status=cart_off');
    expect(checkoutRefusalHref('failed')).toBeNull();
  });
});

describe('STORE-2b · quantities are decimal strings to 3 places — never a float', () => {
  it('milli / qtyText: string math', () => {
    expect([milli('2.5'), milli('2.500'), milli(34), milli('0.001'), milli('1.0005'), milli('-1'), milli('1e3')]).toEqual([2500n, 2500n, 34000n, 1n, null, null, null]);
    expect([qtyText('5.000'), qtyText('2.500'), qtyText('0.125'), qtyText(34)]).toEqual(['5', '2.5', '0.125', '34']);
  });
  it('checkQuantity: not a number · below the minimum · above available · ok (the canonical text)', () => {
    expect(checkQuantity('abc')).toEqual({ ok: false, refusal: 'not_a_number' });
    expect(checkQuantity('0')).toEqual({ ok: false, refusal: 'not_a_number' });
    expect(checkQuantity('2.0001')).toEqual({ ok: false, refusal: 'not_a_number' });
    expect(checkQuantity('4.999', { min: '5.000' })).toEqual({ ok: false, refusal: 'below_min' });
    expect(checkQuantity('34.001', { min: '5', available: '34.000' })).toEqual({ ok: false, refusal: 'above_available' });
    expect(checkQuantity('2.50', { min: '0.000', available: 34 })).toEqual({ ok: true, qty: '2.5' });
    expect(checkQuantity('5', { min: '5.000', available: '5' })).toEqual({ ok: true, qty: '5' });
    // the float trap the string math avoids: 0.1 + 0.2 typed as text is exactly 0.3
    expect(checkQuantity('0.3', { available: '0.3' })).toEqual({ ok: true, qty: '0.3' });
  });
});

describe('STORE-2b · both prices and the delta — formatted with the currency\'s own exponent, the delta is the server\'s', () => {
  it('INR (2 places): added → current, signed delta', () => {
    expect(driftView({ priceChanged: true, addedPriceMinor: '252000', currentPriceMinor: '256000', priceDeltaMinor: '4000', currencyCode: 'INR' }, 'en'))
      .toEqual({ added: '₹2,520.00', current: '₹2,560.00', delta: '+₹40.00', up: true });
    expect(driftView({ priceChanged: true, addedPriceMinor: '256000', currentPriceMinor: '252000', priceDeltaMinor: '-4000', currencyCode: 'INR' }, 'en')?.delta).toBe('−₹40.00');
  });
  it('JPY (0 places) and BHD (3 places) — never two assumed decimals', () => {
    expect(driftView({ priceChanged: true, addedPriceMinor: '1000', currentPriceMinor: '1200', priceDeltaMinor: '200', currencyCode: 'JPY' }, 'en')?.delta).toMatch(/^\+\S*¥\s?200$/);   // 200 yen — not 2.00
    expect(driftView({ priceChanged: true, addedPriceMinor: '1000', currentPriceMinor: '1500', priceDeltaMinor: '500', currencyCode: 'BHD' }, 'en')?.delta).toMatch(/0\.500/);
  });
  it('no drift / an unknown currency → no view (never printed as rupees)', () => {
    expect(driftView({ priceChanged: false, addedPriceMinor: '1', currentPriceMinor: '1', priceDeltaMinor: null, currencyCode: 'INR' }, 'en')).toBeNull();
    expect(driftView({ priceChanged: true, addedPriceMinor: '1', currentPriceMinor: '2', priceDeltaMinor: '1', currencyCode: null }, 'en')).toBeNull();
  });
  it('the page never subtracts money: features/store2b/cart.ts holds no BigInt arithmetic on prices', () => {
    const src = readFileSync(require.resolve('../features/store2b/cart'), 'utf8');
    expect(src).not.toMatch(/PriceMinor\)\s*-|BigInt\([^)]*PriceMinor/);
  });
});

describe('STORE-2b · the resolve logic and the chain in the URL', () => {
  it('a line blocks checkout when it cannot be bought, is below its minimum, above available, or not re-agreed', () => {
    expect(lineProblems(LINE())).toEqual([]);
    expect(lineProblems(LINE({ reason: 'sold_out', purchasable: false, priceChanged: true }))).toEqual(['reason']);
    expect(lineProblems(LINE({ belowMin: true, priceChanged: true }))).toEqual(['below_min', 'drift']);
    expect(lineProblems(LINE({ overAvailable: true }))).toEqual(['over_available']);
    expect(lineProblems(LINE({ reason: undefined, purchasable: false }))).toEqual(['reason']);    // an older API: the boolean still blocks
    expect(resolveState({ items: [LINE(), LINE({ listingId: 'l2', priceChanged: true }), LINE({ listingId: 'l3', belowMin: true })] })).toEqual({ blocked: 2, first: 'line-l2' });
    expect(resolveState({ items: [LINE()] })).toEqual({ blocked: 0, first: null });
  });
  it('cartChain reads the step, the act, the line, the refusal and the kept value; junk falls back safely', () => {
    expect(cartChain({ step: 'error', line: '0208b000-0000-7000-8000-000000000001', err: 'below_min', qty: '3' }))
      .toMatchObject({ step: 'error', line: '0208b000-0000-7000-8000-000000000001', err: 'below_min', qty: '3' });
    expect(cartChain({ step: 'confirm', act: 'accept', line: '0208b000-0000-7000-8000-000000000002' })).toMatchObject({ step: 'confirm', act: 'accept' });
    expect(cartChain({ step: 'nope', act: 'drop', line: 'x"><script>', done: 'hacked' })).toMatchObject({ step: null, act: null, line: null, done: null });
    expect(cartHref('anand-fpo', { done: 'removed', x: '' }, 'line-l1')).toBe('/anand-fpo/cart?done=removed#line-l1');
  });
});

describe('STORE-2b · the registries (brief §E, the 16 canon files)', () => {
  it('the 16 canon files of the wave, each with a verdict; the four licence pages REFUSED citing founder D1 (not decor)', () => {
    const files = STORE2B_CHAIN_PAGES.map((p) => p.file);
    expect(files).toEqual(['W281-store-cart.html', 'W3041-store-cart-form-form-error.html', 'W3042-store-cart-form-review.html', 'W3043-store-cart-form-success.html',
      'W3044-store-cart-form-failure.html', 'W3045-store-cart-mutate-confirm.html', 'W3046-store-cart-mutate-success.html', 'W3047-store-cart-mutate-failure.html',
      'W3092-store-inputs-form-form-error.html', 'W3093-store-inputs-form-review.html', 'W3094-store-inputs-form-success.html', 'W3095-store-inputs-form-failure.html',
      'W3099-store-listing-form-form-error.html', 'W3100-store-listing-form-review.html', 'W3101-store-listing-form-success.html', 'W3102-store-listing-form-failure.html']);
    for (const p of STORE2B_CHAIN_PAGES.filter((x) => /^W309[2-5]/.test(x.file))) expect(p.verdict).toMatch(/^REFUSED — founder D1/);
    expect(STORE2B_CHAIN_PAGES.filter((x) => /^DELTA/.test(x.verdict)).map((x) => x.file)).toEqual(['W3042-store-cart-form-review.html', 'W3100-store-listing-form-review.html']);
  });
  it('every refusal has a key in all three catalogues that says no; ids unique; the DELTAs named', () => {
    const ids = STORE2B_REFUSALS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of STORE2B_REFUSALS) {
      for (const cat of [en, hi, gu]) expect([r.key, typeof cat[r.key]]).toEqual([r.key, 'string']);
      expect([r.key, /\bnot\b|\bno\b|\bnever\b|\bnobody\b|\bnothing\b/i.test(en[r.key])]).toEqual([r.key, true]);
    }
    expect(store2bRefusalKeys('cart').length).toBe(15);
    expect(STORE2B_DELTAS.map((d) => d.id)).toEqual(['cart_route', 'quantity_review', 'add_review', 'add_button_total', 'chain_back_links', 'three_route_checkout', 'qty_stepper']);
  });
});
