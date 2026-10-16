// apps/web-storefront/src/test/store2c-checkout.spec.ts · PC-56 STORE-2c — the money wave's PURE half (features/store2c/{checkout,auction}.ts, the
// refusal lists) and the catalogue guards for every STORE-2c string:
//   • steps: a step is never reached past its prerequisite; the server-held state codec re-validates every field and ignores another store's;
//   • the add-address rule is the API's (4–10 digits, any country), the values kept, each field refused by name;
//   • the wallet is offered only when its balance covers the bill in the same currency (D6); OFF → only "on delivery" (HOTFIX-4 D2);
//   • the money refusals and the payment-processing states map exhaustively; "Send again" only after a failure or a lapse;
//   • the auction: its state from the read, the EMD rule as a rate, a typed bid parsed with the API's exponent (string math);
//   • NO MONEY ARITHMETIC: the feature files are grepped for `*` / `+` / `-` applied to a minor-unit figure;
//   • the §E refusals: every one in all three catalogues, each saying no; the 15 canon files recorded with a verdict;
//   • the catalogues: no digit, no currency sign, no person placeholder in a STORE-2c value; the platform's name only as {platform}; the refused
//     claims appear only inside a refusal.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHECKOUT_STEPS, EMPTY_STATE, addressBody, addressCard, addressValues, attemptKey, attemptToOpen, canSendAgain, checkAddress, checkoutHref, confirmHref,
  decodeState, effectivePay, encodeState, failureReasonKey, moneyRefusalKey, moneyRefusalOf, payHref, paymentOffers, processingView, readDecimal,
  readMoneyRefusal, resolveStep, walletCovers, afterPlacement, MONEY_REFUSALS, FAILURE_REASONS, POSTAL_CODE_RE,
} from '../features/store2c/checkout';
import { auctionState, bidMinor, emdRule } from '../features/store2c/auction';
import { STORE2C_REFUSALS, STORE2C_CHAIN_PAGES, STORE2C_DELTAS, store2cRefusalKeys } from '../features/store2/refusals';
import { PAYMENT_FAILURE_REASONS } from '@krishalaya/sdk-js';
import { PLATFORM_BRAND } from '@krishalaya/tokens';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CATS = { en, hi, gu } as Record<string, Record<string, string>>;
const U1 = '0209c000-0000-7000-8000-000000000001';
const U2 = '0209d000-0000-7000-8000-000000000001';

describe('STORE-2c · the steps and the server-held state', () => {
  it('three steps; payment and review need a chosen address; anything unknown is the address step', () => {
    expect(CHECKOUT_STEPS).toEqual(['address', 'payment', 'review']);
    const s = { ...EMPTY_STATE('anand-fpo'), addressId: U1 };
    expect(resolveStep('review', s)).toBe('review');
    expect(resolveStep(['payment'], s)).toBe('payment');
    expect(resolveStep('review', EMPTY_STATE('anand-fpo'))).toBe('address');
    expect(resolveStep('pay', s)).toBe('address');
    expect(resolveStep(undefined, null)).toBe('address');
  });
  it('the codec round-trips, re-validates every field, and ignores a state minted for ANOTHER store', () => {
    const s = { ...EMPTY_STATE('anand-fpo'), addressId: U1, methodId: U2, pay: 'wallet' as const, coupon: 'SAVE10' };
    const raw = encodeState(s);
    expect(decodeState(raw, 'anand-fpo')).toEqual(s);
    expect(decodeState(raw, 'kisan-sathi')).toBeNull();
    const forged = Buffer.from(JSON.stringify({ v: 1, slug: 'anand-fpo', addressId: 'x; DROP', methodId: U2, pay: 'card', coupon: 'bad coupon!' })).toString('base64url');
    expect(decodeState(forged, 'anand-fpo')).toMatchObject({ addressId: null, methodId: U2, pay: null, coupon: null });
    expect(decodeState('not-base64-json', 'anand-fpo')).toBeNull();
    expect(decodeState('x'.repeat(7000), 'anand-fpo')).toBeNull();
  });
  it('hrefs carry only the step and plain statuses; placement goes to THIS store\'s pay step or confirmation', () => {
    expect(checkoutHref('anand-fpo', 'review', { status: 'stock', available: '4.000', bogus: undefined })).toBe('/anand-fpo/checkout?step=review&status=stock&available=4.000');
    expect(payHref('anand-fpo', 'o1', 'g1')).toBe('/anand-fpo/checkout/pay?o=o1&g=g1');
    expect(confirmHref('anand-fpo', 'o1', null)).toBe('/anand-fpo/checkout/confirm?o=o1');
    expect(afterPlacement('anand-fpo', { orders: [{ id: 'o1', paymentState: 'pending' }], checkoutGroupId: null })).toBe('/anand-fpo/checkout/pay?o=o1');
    expect(afterPlacement('anand-fpo', { orders: [{ id: 'o1', paymentState: 'none' }], checkoutGroupId: null }, 'user_limit')).toBe('/anand-fpo/checkout/confirm?o=o1&cn=user_limit');
    expect(afterPlacement('anand-fpo', { orders: [{ id: 'o1', paymentState: 'pending' }, { id: 'o2', paymentState: 'pending' }], checkoutGroupId: 'g' })).toBe('/anand-fpo/checkout/confirm?g=g');
    expect(afterPlacement('anand-fpo', { orders: [], checkoutGroupId: null })).toBeNull();
  });
});

describe('STORE-2c · the add-address chain (the API\'s rule)', () => {
  const vals = (o: Record<string, string>) => addressValues((k) => o[k]);
  it('the postal rule is the address book\'s: 4–10 digits, any country (no Indian-only six-digit PIN)', () => {
    expect(POSTAL_CODE_RE.source).toBe('^\\d{4,10}$');
    expect(checkAddress(vals({ line1: '12 Market Road', pincode: '1010', countryCode: 'us' }))).toEqual({});
    expect(checkAddress(vals({ line1: 'Plot 14', pincode: '382330', countryCode: 'IN' }))).toEqual({});
  });
  it('each field refused by name; the values are what the form re-renders', () => {
    const v = vals({ line1: 'ab', pincode: '12345678901', countryCode: '1', contactPhone: 'call me', labelId: 'warehouse' });
    expect(checkAddress(v)).toEqual({ line1: 'too_short', pincode: 'postal', countryCode: 'country', contactPhone: 'phone', labelId: 'label' });
    expect(checkAddress(vals({}))).toMatchObject({ line1: 'required', pincode: 'required' });
    expect(v.line1).toBe('ab');
  });
  it('the API body omits empty optionals and carries the buyer\'s country', () => {
    expect(addressBody(vals({ line1: 'Plot 14', pincode: '382330', countryCode: 'in' }))).toEqual({ line1: 'Plot 14', pincode: '382330', countryCode: 'IN' });
  });
  it('a card: the label\'s NAME, the lines, the receiver and the phone MASKED (never the number)', () => {
    const c = addressCard({ id: U1, line1: 'Plot 14', village: 'Ahmedabad', pincode: '382330', labelId: 'L', contactName: 'Nilesh Shah', contactPhone: '+91 9876543742', isDefault: true }, new Map([['L', 'Warehouse']]));
    expect(c).toEqual({ id: U1, label: 'Warehouse', lines: 'Plot 14, Ahmedabad, 382330', receiver: 'Nilesh Shah', phoneMasked: '+91 98••• ••742', isDefault: true });
    expect(addressCard({ id: U1, line1: 'x', labelId: 'gone', isDefault: false }, new Map()).label).toBeNull();
  });
});

describe('STORE-2c · payment methods (D6 / HOTFIX-4 D2)', () => {
  it('the wallet covers only when balance ≥ the bill, in the SAME currency, both well-formed', () => {
    expect(walletCovers({ availableMinor: '8236375', currencyCode: 'INR' }, { totalMinor: '8236375', currencyCode: 'inr' })).toBe(true);
    expect(walletCovers({ availableMinor: '8236374', currencyCode: 'INR' }, { totalMinor: '8236375', currencyCode: 'INR' })).toBe(false);
    expect(walletCovers({ availableMinor: '99999999', currencyCode: 'USD' }, { totalMinor: '1', currencyCode: 'INR' })).toBe(false);
    expect(walletCovers({ availableMinor: '1.5', currencyCode: 'INR' }, { totalMinor: '1', currencyCode: 'INR' })).toBe(false);
    expect(walletCovers(null, { totalMinor: '1', currencyCode: 'INR' })).toBe(false);
  });
  it('offers: OFF → on delivery only; ON → online, + wallet when it covers; a stale wallet choice falls back to online', () => {
    expect(paymentOffers(false, true)).toEqual(['on_delivery']);
    expect(paymentOffers(true, false)).toEqual(['online']);
    expect(paymentOffers(true, true)).toEqual(['online', 'wallet']);
    expect(effectivePay('wallet', ['online'])).toBe('online');
    expect(effectivePay('wallet', ['online', 'wallet'])).toBe('wallet');
    expect(effectivePay(null, ['on_delivery'])).toBe('on_delivery');
  });
});

describe('STORE-2c · the money refusals and the payment-processing states', () => {
  it('every money code maps to its named refusal (and its key exists in all three catalogues); unknown → null', () => {
    expect(['LISTING_INSUFFICIENT_STOCK', 'MIXED_CURRENCY', 'PAYMENT_ATTEMPT_LIVE', 'WALLET_INSUFFICIENT_BALANCE', 'CHARGE_METHOD_UNSUPPORTED', 'ORDER_NOT_AWAITING_PAYMENT'].map(moneyRefusalOf))
      .toEqual(['stock', 'mixed_currency', 'attempt_live', 'wallet_short', 'charge_method', 'not_awaiting']);
    expect(moneyRefusalOf('SOMETHING')).toBeNull();
    for (const r of MONEY_REFUSALS) for (const cat of Object.values(CATS)) expect([r, typeof cat[moneyRefusalKey(r)]]).toEqual([r, 'string']);
    expect(readMoneyRefusal('stock')).toBe('stock');
    expect(readMoneyRefusal('hand-edited')).toBe('failed');
    expect(readMoneyRefusal('')).toBeNull();
    expect([readDecimal('4.000'), readDecimal('4.0001'), readDecimal('<b>')]).toEqual(['4.000', null, null]);
  });
  it('the processing view from the payment read; a live attempt past its expiry is lapsed', () => {
    const now = new Date('2026-10-15T10:00:00Z');
    expect(processingView(null, now)).toBe('none');
    expect(processingView({ status: 'initiated', expiresAt: '2026-10-15T10:15:00Z' }, now)).toBe('live');
    expect(processingView({ status: 'pending', expiresAt: '2026-10-15T09:59:00Z' }, now)).toBe('expired');
    expect(['success', 'failed', 'expired', 'authorized', 'refund_initiated', 'refunded', 'partially_refunded', 'weird'].map((s) => processingView({ status: s }, now)))
      .toEqual(['success', 'failed', 'expired', 'authorized', 'refunding', 'refunded', 'refunded', 'none']);
  });
  it('"Send again" only after a failure or a lapse; the attempt opened = the live one again, else the next; the key is per attempt', () => {
    expect(['none', 'live', 'failed', 'expired', 'authorized', 'success'].map((v) => canSendAgain(v as never))).toEqual([false, false, true, true, false, false]);
    expect(attemptToOpen('live', { attempts: 2, nextAttempt: 3 })).toBe(2);
    expect(attemptToOpen('failed', { attempts: 2, nextAttempt: 3 })).toBe(3);
    expect(attemptToOpen('none', { attempts: 0, nextAttempt: 1 })).toBe(1);
    expect(attemptKey('o1', 2)).toBe('order-pay:o1:2');
  });
  it('the failure reasons are the API\'s closed list, each with a key in all three catalogues; unknown → the generic', () => {
    expect([...FAILURE_REASONS]).toEqual([...PAYMENT_FAILURE_REASONS]);
    for (const r of FAILURE_REASONS) for (const cat of Object.values(CATS)) expect([r, typeof cat[failureReasonKey(r)]]).toEqual([r, 'string']);
    expect(failureReasonKey('<script>')).toBe('store2c.fail.unknown');
  });
});

describe('STORE-2c · the auction (server figures only)', () => {
  const v = (o: Record<string, unknown>) => ({ status: 'live', isOpen: true, hasBids: true, viewer: null, ...o }) as never;
  it('the state from the read', () => {
    expect(auctionState(v({ hasBids: false }))).toBe('no_bids');
    expect(auctionState(v({ viewer: { bestBidMinor: '632000', leading: true, won: false, orderId: null } }))).toBe('leading');
    expect(auctionState(v({ viewer: { bestBidMinor: '620000', leading: false, won: false, orderId: null } }))).toBe('outbid');
    expect(auctionState(v({ isOpen: false, status: 'settled', viewer: { bestBidMinor: '1', leading: false, won: true, orderId: 'o' } }))).toBe('won');
    expect(auctionState(v({ isOpen: false, status: 'ended' }))).toBe('ended');
    expect(auctionState(v({ status: 'scheduled' }))).toBe('scheduled');
    expect(auctionState(v({}))).toBe('open');
  });
  it('the EMD rule as the API holds it — a flat amount, or a rate in basis points shown as a percentage', () => {
    expect(emdRule({ flatMinor: '500000', pctBps: null })).toEqual({ kind: 'flat', minor: '500000' });
    expect(emdRule({ flatMinor: null, pctBps: 200 })).toEqual({ kind: 'pct', pct: '2' });
    expect(emdRule({ flatMinor: null, pctBps: 250 })).toEqual({ kind: 'pct', pct: '2.5' });
    expect(emdRule({ flatMinor: null, pctBps: 5 })).toEqual({ kind: 'pct', pct: '0.05' });
    expect(emdRule({ flatMinor: '0', pctBps: null })).toBeNull();
  });
  it('a typed bid → minor units with the API\'s exponent (string math; too many decimals / garbage / zero → refused)', () => {
    expect(bidMinor('6,340', 2)).toBe('634000');
    expect(bidMinor('6340.5', 2)).toBe('634050');
    expect(bidMinor('6340.505', 2)).toBeNull();
    expect(bidMinor('100', 0)).toBe('100');
    expect(bidMinor('1.5', 0)).toBeNull();
    expect(bidMinor('0', 2)).toBeNull();
    expect(bidMinor('12abc', 2)).toBeNull();
    expect(bidMinor('5', null)).toBeNull();
  });
});

describe('STORE-2c · no money arithmetic in the storefront\'s money features (brief §C8)', () => {
  it('no `*`, `+` or `-` applied to a minor-unit figure in features/store2c/*', () => {
    for (const f of ['checkout.ts', 'auction.ts']) {
      const src = readFileSync(join(__dirname, '..', 'features', 'store2c', f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const hits = src.split('\n').filter((l) => /\w*Minor\w*\)?\s*[*+-]\s*[\w(]|[\w)]\s*[*+-]\s*\(?\w*Minor\b/.test(l));
      expect([f, hits]).toEqual([f, []]);
    }
  });
  it('the old client bid math is gone (features/auctions/bid.ts deleted)', () => {
    expect(() => readFileSync(join(__dirname, '..', 'features', 'auctions', 'bid.ts'), 'utf8')).toThrow();
  });
});

describe('STORE-2c · the §E refusals, the DELTAs, the chain pages', () => {
  it('every refusal is in all three catalogues and printed on at least one surface; every English one says no', () => {
    expect(STORE2C_REFUSALS.length).toBe(32);
    for (const r of STORE2C_REFUSALS) {
      expect(r.surfaces.length).toBeGreaterThan(0);
      for (const cat of Object.values(CATS)) expect([r.key, typeof cat[r.key]]).toEqual([r.key, 'string']);
      expect([r.key, /\bnot\b|\bno\b|\bnever\b|\bnothing\b|\bnobody\b/i.test(en[r.key as keyof typeof en])]).toEqual([r.key, true]);
    }
    expect(new Set(STORE2C_REFUSALS.map((r) => r.id)).size).toBe(STORE2C_REFUSALS.length);
    for (const s of ['checkout-address', 'checkout-payment', 'checkout-review', 'processing', 'auction'] as const) expect(store2cRefusalKeys(s).length).toBeGreaterThan(2);
  });
  it('the brief §E names are all present', () => {
    const ids = new Set(STORE2C_REFUSALS.map((r) => r.id));
    for (const id of ['one_payment', 'slots', 'self_pickup', 'vehicle_note', 'three_pl', 'gstin', 'per_km', 'slab_50', 'min_450', 'gst_delivery', 'produce_gst', 'hsn',
      'partial_take', 'slot_hold', 'cod', 'neft', 'gst_cards', 'pay_later', 'gateway_degraded', 'helpline', 'quality_6h', 'pay_by_1800', 'shill', 'outbid_sms',
      'seller_rating', 'inpage_methods', 'message_failures', 'oncall']) expect([id, ids.has(id)]).toEqual([id, true]);
    expect(STORE2C_DELTAS.map((d) => d.id)).toEqual(['one_route', 'address_review', 'resend_confirm', 'sheet_methods', 'chain_links', 'review_before_pay']);
  });
  it('the 15 canon files, each with a verdict', () => {
    expect(STORE2C_CHAIN_PAGES.map((p) => p.file)).toEqual([
      'W278-store-listing-auction.html', 'W283-store-checkout-address.html', 'W284-store-checkout-payment.html', 'W285-store-checkout-review.html',
      'W286-store-payment-processing.html', 'W3048-store-checkout-form-form-error.html', 'W3049-store-checkout-form-review.html',
      'W3050-store-checkout-form-success.html', 'W3051-store-checkout-form-failure.html', 'W3052-store-checkout-mutate-confirm.html',
      'W3053-store-checkout-mutate-success.html', 'W3054-store-checkout-mutate-failure.html', 'W3061-store-payment-mutate-confirm.html',
      'W3062-store-payment-mutate-success.html', 'W3063-store-payment-mutate-failure.html',
    ]);
    for (const p of STORE2C_CHAIN_PAGES) expect(p.verdict.length).toBeGreaterThan(10);
  });
});

describe('STORE-2c · the catalogues', () => {
  const keys = Object.keys(en).filter((k) => k.startsWith('store2c.'));
  it('the STORE-2c keys: no digit, no currency sign, no person placeholder; the platform only as {platform} (these are tenant routes)', () => {
    expect(keys.length).toBe(174);   // PC-56 STORE-3c · C4: + store2c.refused.amount_mismatch (ORDER_PAYMENT_AMOUNT_MISMATCH by name)
    const LITS = [PLATFORM_BRAND.name, 'कृषालय', 'કૃષાલય'];
    for (const [l, cat] of Object.entries(CATS)) for (const k of keys) {
      const v = cat[k];
      expect([l, k, /[0-9०-९૦-૯]/.test(v.replace(/\{[a-z]+\}/gi, ''))]).toEqual([l, k, false]);
      expect([l, k, /[₹$€£¥]/.test(v)]).toEqual([l, k, false]);
      expect([l, k, /\{(name|seller|sellerName|farmer|farmerName|member|memberNo|fullName|owner|bidder)\}/i.test(v)]).toEqual([l, k, false]);
      for (const lit of LITS) expect([l, k, v.includes(lit)]).toEqual([l, k, false]);
    }
    expect(en['store2c.review.processedBy']).toContain('{platform}');
  });
  it('the refused claims appear only inside a refusal — never as an offer', () => {
    const REFUSED = [
      /one payment covers|escrow splits/i, /chosen separately|delivery slots? —/i, /self-pickup from the centre at no/i, /travels with the address to the driver/i,
      /3PL quotes are offered/i, /add GSTIN here/i, /\/qtl\/100\s?km/i, /₹?50 slab/i, /minimum ₹?450/i, /\+18% GST|18% on delivery/i, /produce 0% GST/i,
      /take 4, or drop/i, /30-minute slot hold|slots held/i, /capped at ₹?20,000/i, /NEFT\/RTGS reference matching for/i, /GST-matched invoices automatically/i,
      /partner-bank decision/i, /held for 30 minutes/i, /1800-419-0123|quote CHK-/i, /6h perishable|6 h quality/i, /tomorrow 18:00/i, /shill bidding is detected/i,
      /notify you instantly on app \+ SMS/i, /4\.6★|89 sales/i, /page the on-call/i,
    ];
    for (const [l, cat] of Object.entries(CATS)) for (const [k, v] of Object.entries(cat)) {
      if (/\.refusal\./.test(k)) continue;
      for (const re of REFUSED) expect([l, k, re.test(v)]).toEqual([l, k, false]);
    }
  });
  it('D5 and D6 sentences, exactly once each, everywhere they are printed', () => {
    expect(en['bill.taxIncluded']).toBe('GST, where it applies, is included in the price and shown on your invoice.');
    expect(en['store2c.escrow']).toBe('Your payment is held by the platform until your order is completed, then released to the organisation.');
    expect(en['checkout.payNote']).toBe(en['store2c.escrow']);
    expect(en['store2c.refund.true']).toBe('If the organisation declines or you cancel before dispatch, a paid order is refunded to the source automatically.');
  });
});
