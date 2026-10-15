// apps/web-storefront/src/test/store3b-offers.spec.ts · PC-56 STORE-3b · C6 (pure) — the offer pages' rules without React:
//   • E9 status parity: the six statuses the API's state machine has (read from its own source), each labelled in en / hi / gu; the five
//     phantom statuses (active, pending, declined, withdrawn, cancelled) are GONE from every catalogue and every set;
//   • E1 the turn model: an act only when the API says it is the buyer's turn AND lists the act (fail-closed); whose price is on the table by
//     the entity's parity rule;
//   • the refusal map (every key ×3, every English refusal says no) and the 8 canon files; the decline reasons ×3;
//   • the counter price by the LISTING's exponent; the "Offer again" prefill codec; the named outcomes;
//   • NO MONEY ARITHMETIC (the `*` grep) and NO 'INR' literal on the offer pages (Rule Zero).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  OFFER_STATUS_LIST, PHANTOM_OFFER_STATUSES, NEGOTIABLE, TERMINAL, offerStatusKey, actsFor, onTable, readAct, roundKey, ROUND_LINES, counterMinor,
  offerAgainHref, readOfferPrefill, offersAgain, offerFailureOf, readFailure, OFFER_FAILURES, OFFER_DECLINE_REASON_LIST, declineReasonKey,
  readDeclineReason, offerTabs, tabCountForm, readOfferTab, offersHref, offerHref, conversionView, offerActKey, ACT_KEY, readAvailable, readOfferOk,
} from '../features/store3b/offers';
import { STORE3B_REFUSALS, STORE3B_DELTAS, STORE3B_CHAIN_PAGES, store3bRefusalKeys } from '../features/store3b/refusals';

const CATS: Record<string, Record<string, string>> = { en, hi, gu };
const SRC = path.join(__dirname, '..');
const API_OFFERS = path.join(SRC, '..', '..', 'api', 'src', 'modules', 'offers', 'domain');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('STORE-3b · E9 the six statuses, labelled ×3; the five phantoms gone', () => {
  it('the storefront list IS the API\'s state machine list (read from its source)', () => {
    const src = fs.readFileSync(path.join(API_OFFERS, 'listing-offer.state.ts'), 'utf8');
    const m = /OFFER_STATUSES = \[([^\]]+)\]/.exec(src);
    expect(m).not.toBeNull();
    expect([...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])).toEqual([...OFFER_STATUS_LIST]);
  });
  it.each(['en', 'hi', 'gu'])('%s: every status has its own label; no phantom status survives', (l) => {
    for (const s of OFFER_STATUS_LIST) expect([s, typeof CATS[l][`offers.status.${s}`]]).toEqual([s, 'string']);
    for (const p of PHANTOM_OFFER_STATUSES) expect([p, CATS[l][`offers.status.${p}`]]).toEqual([p, undefined]);
    expect(CATS[l]['offers.messageSeller']).toBeUndefined();   // founder D6: the act is gone, and its label with it
  });
  it('no set the pages use holds a phantom; an unknown status is said, never printed raw', () => {
    for (const p of PHANTOM_OFFER_STATUSES) { expect(NEGOTIABLE).not.toContain(p); expect(TERMINAL).not.toContain(p); }
    expect(offerStatusKey('withdrawn')).toBe('store3b.status.unknown');
    expect(offerStatusKey('open')).toBe('offers.status.open');
  });
});

describe('STORE-3b · E1 the turn model (the API\'s word — fail-closed)', () => {
  const live = { status: 'countered', round: 2, yourTurn: true, allowedActs: ['accept', 'counter', 'decline'] };
  it('acts only on the buyer\'s turn, only those the API lists, only while negotiable', () => {
    expect(actsFor(live)).toEqual(['accept', 'counter', 'decline']);
    expect(actsFor({ ...live, yourTurn: false })).toEqual([]);
    expect(actsFor({ ...live, yourTurn: undefined })).toEqual([]);
    expect(actsFor({ ...live, allowedActs: ['decline'] })).toEqual(['decline']);
    expect(actsFor({ ...live, allowedActs: undefined })).toEqual([]);
    expect(actsFor({ ...live, status: 'accepted' })).toEqual([]);
    expect(actsFor({ ...live, status: 'withdrawn' })).toEqual([]);
  });
  it('whose price is on the table — the entity\'s parity rule (odd: the buyer\'s offer awaits the seller), read from its source', () => {
    const src = fs.readFileSync(path.join(API_OFFERS, 'listing-offer.entity.ts'), 'utf8');
    expect(src).toMatch(/isSellersTurn\(\): boolean \{ return isNegotiable\(this\.props\.status\) && this\.props\.round % 2 === 1; \}/);
    expect([1, 2, 3, 4].map(onTable)).toEqual(['yours', 'theirs', 'yours', 'theirs']);
    expect([readAct('accept'), readAct('lapse'), readAct(undefined)]).toEqual(['accept', null, null]);
  });
  it('every thread line the machine can write has a key ×3; anything else is "a step of this negotiation"', () => {
    for (const l of ['en', 'hi', 'gu']) for (const line of [...ROUND_LINES, 'unknown']) expect([l, line, typeof CATS[l][`store3b.round.${line}`]]).toEqual([l, line, 'string']);
    expect(roundKey({ party: 'seller', act: 'offer' })).toBe('store3b.round.unknown');
    expect(roundKey({ party: 'system', act: 'expire' })).toBe('store3b.round.system.expire');
    expect(roundKey({ party: 'buyer', act: 'counter' })).toBe('store3b.round.you.counter');
  });
  it('the conversion: creating until the relay links the order, then the order', () => {
    expect(conversionView({ status: 'accepted', convertedOrderId: null })).toEqual({ kind: 'creating' });
    expect(conversionView({ status: 'converted', convertedOrderId: 'o1' })).toEqual({ kind: 'converted', orderId: 'o1' });
    expect(conversionView({ status: 'open' })).toBeNull();
  });
});

describe('STORE-3b · the refusals, the reasons, the chips', () => {
  it('every refusal has its key ×3; every English refusal says no; the 8 canon files and the deltas are recorded', () => {
    for (const r of STORE3B_REFUSALS) for (const l of ['en', 'hi', 'gu']) expect([l, r.key, typeof CATS[l][r.key]]).toEqual([l, r.key, 'string']);
    for (const r of STORE3B_REFUSALS) expect([r.key, /\bnot\b|\bno\b|\bnever\b|\bnothing\b|\bnobody\b|\bcannot\b/i.test(en[r.key])]).toEqual([r.key, true]);
    expect(STORE3B_CHAIN_PAGES.map((p) => p.file.slice(0, 5))).toEqual(['W293-', 'W294-', 'W3121', 'W3122', 'W3123', 'W3124', 'W3125', 'W3126']);
    expect(STORE3B_DELTAS.map((d) => d.id)).toEqual(expect.arrayContaining(['offer_again', 'lapse_copy', 'offers_route', 'keyset_pages']));
    expect(store3bRefusalKeys('offer')).toEqual(expect.arrayContaining(['store3b.refusal.mandi', 'store3b.refusal.aiHint', 'store3b.refusal.messageSeller', 'store3b.refusal.notes']));
    expect(store3bRefusalKeys('offers')).toEqual(expect.arrayContaining(['store3b.refusal.buyingHistory', 'store3b.refusal.farmerName']));
  });
  it('the six decline reasons (founder D3) ×3; anything else is no reason', () => {
    expect(OFFER_DECLINE_REASON_LIST).toEqual(['price', 'lot_committed', 'quantity', 'timing', 'changed_mind', 'other']);
    for (const l of ['en', 'hi', 'gu']) for (const r of OFFER_DECLINE_REASON_LIST) expect(typeof CATS[l][declineReasonKey(r)]).toBe('string');
    expect([readDeclineReason('lot_committed'), readDeclineReason('holding_for_auction'), readDeclineReason(undefined)]).toEqual(['lot_committed', null, null]);
  });
  it('the chips: all + six, bounded counts ("(n+)"), the current one, hrefs under the organisation', () => {
    const tabs = offerTabs('anand-fpo', 'countered', { all: { count: 9, capped: false }, expired: { count: 100, capped: true } });
    expect(tabs.map((x) => x.tab)).toEqual(['all', ...OFFER_STATUS_LIST]);
    expect(tabs.find((x) => x.current)?.tab).toBe('countered');
    expect(tabs.find((x) => x.tab === 'expired')?.count).toEqual({ count: 100, capped: true });
    expect(tabs.find((x) => x.tab === 'open')?.count).toBeNull();
    expect(tabCountForm({ count: 100, capped: true })).toEqual({ key: 'store3a.tab.countCapped', n: 100 });
    expect([readOfferTab('rejected'), readOfferTab('declined'), readOfferTab(['open'])]).toEqual(['rejected', 'all', 'open']);
    expect(offersHref('anand-fpo', 'expired', 'c1')).toBe('/anand-fpo/offers?status=expired&cursor=c1');
    expect(offerHref('anand-fpo', 'o1', { act: 'accept' })).toBe('/anand-fpo/offers/o1?act=accept');
  });
});

describe('STORE-3b · the counter price, the prefill codec, the outcomes', () => {
  it('the counter price uses the LISTING\'s exponent — never two decimals by default', () => {
    expect([counterMinor('2490', 'INR'), counterMinor('2,490.5', 'INR'), counterMinor('2490.555', 'INR')]).toEqual(['249000', '249050', null]);
    expect([counterMinor('2490', 'JPY'), counterMinor('2490.5', 'JPY')]).toEqual(['2490', null]);
    expect([counterMinor('12.345', 'BHD'), counterMinor('0', 'INR'), counterMinor('abc', 'INR'), counterMinor('2490', null)]).toEqual(['12345', null, null, null]);
  });
  it('"Offer again" (a chain-form): the listing\'s offer form with the old terms, in the listing\'s major units; read back shape-checked', () => {
    const href = offerAgainHref('anand-fpo', 'l1', '12.000', '244000', 'INR');
    expect(href).toBe('/anand-fpo/listings/l1?qty=12&price=2440#offer');
    expect(offerAgainHref('anand-fpo', 'l1', '2.500', '2440', 'JPY')).toBe('/anand-fpo/listings/l1?qty=2.5&price=2440#offer');
    expect(readOfferPrefill({ qty: '12', price: '2440.00' })).toEqual({ qty: '12', price: '2440.00' });
    expect(readOfferPrefill({ qty: '<script>', price: '-1' })).toEqual({ qty: null, price: null });
    expect([offersAgain('expired'), offersAgain('rejected'), offersAgain('open'), offersAgain('converted')]).toEqual([true, true, false, false]);
  });
  it('every API refusal → its named failure (never "try again" for a cause the server named); each has a sentence ×3', () => {
    expect([offerFailureOf('OFFER_NOT_YOUR_TURN'), offerFailureOf('OFFER_EXPIRED'), offerFailureOf('OFFER_NOT_NEGOTIABLE'), offerFailureOf('OFFER_STOCK_SHORT'),
      offerFailureOf('OFFER_LISTING_UNAVAILABLE'), offerFailureOf('OFFER_SELLER_UNAVAILABLE'), offerFailureOf('OFFER_MAX_LIFE'), offerFailureOf('OFFER_INVALID'),
      offerFailureOf('OFFER_DECLINE_REASON_UNKNOWN'), offerFailureOf('CONFLICT', 409), offerFailureOf('NOT_FOUND', 404), offerFailureOf(null, 500)])
      .toEqual(['not_your_turn', 'expired', 'not_negotiable', 'stock_short', 'listing_unavailable', 'seller_unavailable', 'max_life', 'invalid_price',
        'reason_unknown', 'concurrency', 'failed', 'failed']);
    for (const l of ['en', 'hi', 'gu']) for (const f of OFFER_FAILURES) expect([l, f, typeof CATS[l][`store3b.err.${f}`]]).toEqual([l, f, 'string']);
    expect([readFailure('stock_short'), readFailure('nonsense'), readFailure('')]).toEqual(['stock_short', 'failed', null]);
    expect([readAvailable('4.500'), readAvailable('4.5kg')]).toEqual(['4.500', null]);
    expect([readOfferOk('accepted'), readOfferOk('lapsed')]).toEqual(['accepted', null]);
    const k = offerActKey('accept', '0211a000-0000-7000-8000-000000000001', 'n');
    expect([ACT_KEY.test(k), k.length <= 120]).toEqual([true, true]);
  });
});

describe('STORE-3b · no money arithmetic, no \'INR\' on the offer pages', () => {
  const FILES = ['features/store3b/offers.ts', 'app/[tenantSlug]/offers/page.tsx', 'app/[tenantSlug]/offers/[id]/page.tsx', 'app/[tenantSlug]/offers/[id]/actions.ts',
    'app/(platform)/offers/page.tsx', 'app/(platform)/offers/[id]/page.tsx'];
  it.each(FILES)('%s: no multiplication (every amount is the API\'s) and no currency literal', (f) => {
    const src = strip(fs.readFileSync(path.join(SRC, f), 'utf8'));
    expect(src.match(/[\w)\]]\s*\*\s*[\w(]/g) ?? []).toEqual([]);
    expect(src.match(/['"`](INR|USD|₹)['"`]/g) ?? []).toEqual([]);
  });
  it('the platform\'s old offer action file is deleted (its "message seller" with it — founder D6)', () => {
    expect(fs.existsSync(path.join(SRC, 'app/(platform)/offers/[id]/actions.ts'))).toBe(false);
  });
});
