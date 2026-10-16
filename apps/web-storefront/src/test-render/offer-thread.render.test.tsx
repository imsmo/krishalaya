// apps/web-storefront/src/test-render/offer-thread.render.test.tsx · PC-56 STORE-3b · C3 — canon W294 + the response chain W3121–W3123:
//   • the acts ONLY on the buyer's turn (the API's `yourTurn` + `allowedActs`); "or do nothing — it lapses at …" (founder D4: no lapse act);
//   • the three confirms (accept: what it creates with the SERVER value, the regime, the fees, the reservation; counter: the typed price by the
//     LISTING's exponent and the next round's hours; decline: the six reasons, required) with a key minted at render and reused on Retry;
//   • the creating state (Refresh) and the converted order link; the decline reason;
//   • every named failure (W3123), the stock refusal naming the organisation's remainder;
//   • the rounds in order — never a name, never a note; the mandi / AI hint / farmer / notes / message-seller claims refused by name;
//   • the clock from the read (respond-by, hours per round, the ceiling); the flag OFF state; the actions' calls, keys and redirects;
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }) }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) }));
jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: jest.requireActual('./store3b-fixtures').C.pending === true }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: 'rzp_test_x' } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store3b-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/auth', () => ({ getSessionTenant: () => 't', hasSessionCookie: () => true }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store3b-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import TenantOfferThread from '../app/[tenantSlug]/offers/[id]/page';
import PlatformOfferDoor from '../app/(platform)/offers/[id]/page';
import { acceptOfferAction, counterOfferAction, declineOfferAction } from '../app/[tenantSlug]/offers/[id]/actions';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, OFFER, OFF, SLUG, FARMER, SELLER_UUID, ORDER_ID } from './store3b-fixtures';
import { OFFER_DECLINE_REASON_LIST, OFFER_FAILURES } from '../features/store3b/offers';
import { store3bRefusalKeys } from '../features/store3b/refusals';

const thread = async (id: string, sp: Record<string, string> = {}) => renderToStaticMarkup(await TenantOfferThread({ params: { tenantSlug: SLUG, id }, searchParams: sp }));
const KEY = 'accept:0211c000-0000-7000-8000-000000000002:k1';
const form = (o: Record<string, string>) => { const fd = new FormData(); for (const [k, v] of Object.entries(o)) fd.set(k, v); return fd; };
const redirectOf = async (p: Promise<unknown>) => { try { await p; return 'no redirect'; } catch (e) { return String((e as Error).message); } };
beforeEach(() => {
  reset();
  C.offers[OFF.countered] = OFFER(OFF.countered);
  C.offers[OFF.open] = OFFER(OFF.open, { status: 'open', round: 1, counterPriceMinor: null, currentPriceMinor: '244000', offerValueMinor: '2928000', yourTurn: false, allowedActs: [],
    rounds: [{ round: 1, party: 'buyer', act: 'offer', priceMinor: '244000', at: '2026-10-15T05:35:00.000000Z' }] });
});

describe('STORE-3b · W294 the acts only on the buyer\'s turn (E1)', () => {
  it('the buyer\'s turn → Accept / Counter / Decline (each to its confirm) + "or do nothing — it lapses at …"; no lapse act', async () => {
    const h = await thread(OFF.countered);
    for (const a of ['accept', 'counter', 'decline']) expect(h).toContain(`data-kv-act-start="${a}" href="/${SLUG}/offers/${OFF.countered}?act=${a}"`);
    expect(h).toContain('data-kv-lapse="copy"');
    expect(text(h)).toMatch(/Or do nothing — it lapses at /);
    expect(h).not.toMatch(/data-kv-act-start="lapse"/);
  });
  it('the organisation\'s turn → no act at all (the API says not yours), the waiting sentence; a forced ?act=accept shows nothing either', async () => {
    for (const sp of [{}, { act: 'accept' }] as Array<Record<string, string>>) {
      const h = await thread(OFF.open, sp);
      expect(h).not.toContain('data-kv-act-start=');
      expect(h).not.toContain('data-kv-confirm=');
      expect(h).toContain('data-kv-waiting="organisation"');
    }
  });
  it('FAIL-CLOSED: `yourTurn` false wins even if a (stale) read lists acts — the organisation\'s turn never shows Accept', async () => {
    C.offers[OFF.open] = OFFER(OFF.open, { status: 'open', round: 1, yourTurn: false, allowedActs: ['accept', 'counter', 'decline'] });
    const h = await thread(OFF.open, { act: 'accept' });
    expect(h).not.toContain('data-kv-act-start=');
    expect(h).not.toContain('data-kv-confirm="accept"');
  });
  it('yourTurn true but the API lists only decline → only Decline', async () => {
    C.offers[OFF.countered] = OFFER(OFF.countered, { allowedActs: ['decline'] });
    const h = await thread(OFF.countered);
    expect(h).toContain('data-kv-act-start="decline"');
    expect(h).not.toContain('data-kv-act-start="accept"');
  });
});

describe('STORE-3b · W3121 the three confirms', () => {
  it('ACCEPT: "creates an order for 12 quintal at ₹2,490.00 per unit = ₹29,880.00" (the server value), the regime, the fees, the reservation, a minted key', async () => {
    const h = await thread(OFF.countered, { act: 'accept' });
    expect(h).toContain('data-kv-confirm="accept"');
    expect(text(h)).toContain('Accepting creates an order for 12 quintal at ₹2,490.00 per unit = ₹29,880.00.');
    expect(h).toContain('data-kv-regime="offer"');
    expect(text(h)).toContain(en['store3b.regime']);
    expect(text(h)).toContain(en['store3b.accept.fees']);
    expect(h).toContain('data-kv-reserve="on-accept"');
    expect(h).toMatch(/name="key" value="accept:0211c000-0000-7000-8000-000000000002:[0-9a-f-]{36}"/);
  });
  it('a Retry after a refusal reuses the SAME key (?k=)', async () => {
    const h = await thread(OFF.countered, { act: 'accept', error: 'concurrency', k: KEY });
    expect(h).toContain(`name="key" value="${KEY}"`);
    expect(h).toContain('data-kv-failure="concurrency"');
  });
  it('COUNTER: the price form, then the confirm with the price parsed by the LISTING\'s exponent and the next round\'s hours; an invalid price named', async () => {
    let h = await thread(OFF.countered, { act: 'counter' });
    expect(h).toContain('data-kv-counter="price"');
    h = await thread(OFF.countered, { act: 'counter', price: '2470' });
    expect(h).toContain('data-kv-confirm="counter"');
    expect(h).toContain('data-kv-counter-price="247000"');
    expect(text(h)).toContain('Counter at ₹2,470.00 per quintal for 12 quintal.');
    expect(text(h)).toContain('The organisation then has 48 hours to answer.');
    C.offers[OFF.countered] = OFFER(OFF.countered, { currencyCode: 'JPY' });
    h = await thread(OFF.countered, { act: 'counter', price: '2470.5' });
    expect(h).toContain('data-kv-failure="invalid_price"');
    expect(h).not.toContain('data-kv-confirm="counter"');
  });
  it('DECLINE: the six reasons as required radios, the "no note" sentence', async () => {
    const h = await thread(OFF.countered, { act: 'decline' });
    expect(h).toContain('data-kv-confirm="decline"');
    for (const r of OFFER_DECLINE_REASON_LIST) expect(h).toContain(`data-kv-reason="${r}"`);
    expect((h.match(/type="radio" name="reason"[^>]*required/g) ?? []).length).toBe(6);
    expect(text(h)).toContain(en['store3b.decline.noNote']);
  });
});

describe('STORE-3b · W3122 success and the conversion; W3123 failures by name', () => {
  it('accepted → "your order is being created" with a Refresh; converted → the order link with its status + the regime', async () => {
    C.offers[OFF.accepted] = OFFER(OFF.accepted, { status: 'accepted', conversion: 'creating', yourTurn: false, allowedActs: [] });
    let h = await thread(OFF.accepted, { ok: 'accepted' });
    expect(h).toContain('data-kv-conversion="creating"');
    expect(h).toContain(`href="/${SLUG}/offers/${OFF.accepted}" class="kv-btn" data-kv-refresh="conversion"`);
    expect(h).toContain('data-kv-ok="accepted"');
    C.offers[OFF.converted] = OFFER(OFF.converted, { status: 'converted', convertedOrderId: ORDER_ID, convertedOrderStatus: 'created', conversion: 'converted', yourTurn: false, allowedActs: [] });
    h = await thread(OFF.converted);
    expect(h).toContain(`href="/${SLUG}/orders/${ORDER_ID}"`);
    expect(text(h)).toContain(`Became an order — ${en['order.status.created']}`);
    expect(h).toContain('data-kv-regime="offer"');
  });
  it('declined → who and the reason', async () => {
    C.offers[OFF.rejected] = OFFER(OFF.rejected, { status: 'rejected', declineReasonCode: 'price', declinedBy: 'buyer', yourTurn: false, allowedActs: [] });
    expect(text(await thread(OFF.rejected, { ok: 'declined' }))).toContain(`You declined — ${en['store3b.reason.price']}`);
  });
  it.each(OFFER_FAILURES.filter((f) => f !== 'invalid_price'))('the failure `%s` is said by name', async (f) => {
    const h = await thread(OFF.countered, { act: 'accept', error: f, k: KEY });
    expect(h).toContain(`data-kv-failure="${f}"`);
    if (f !== 'stock_short') expect(text(h)).toContain(en[`store3b.err.${f}`]);
  });
  it('stock short names the organisation\'s remainder: "only 4.5 quintal left — offer again for less, or let this lapse"', async () => {
    const h = await thread(OFF.countered, { act: 'accept', error: 'stock_short', av: '4.500', k: KEY });
    expect(text(h)).toContain('The organisation now has only 4.5 quintal left — offer again for less, or let this lapse.');
  });
  it('a failure after the turn moved still prints by name (no act left to show)', async () => {
    const h = await thread(OFF.open, { act: 'accept', error: 'not_your_turn' });
    expect(h).toContain('data-kv-failure="not_your_turn"');
  });
});

describe('STORE-3b · W294 the thread, the numbers, the clock, the refusals', () => {
  it('the rounds in order — "Your offer — round 1", "The organisation countered — round 2" — never a name; the numbers are the server\'s', async () => {
    const h = await thread(OFF.countered);
    const tx = text(h);
    expect(tx.indexOf('Your offer — round 1')).toBeGreaterThan(-1);
    expect(tx.indexOf('The organisation countered — round 2')).toBeGreaterThan(tx.indexOf('Your offer — round 1'));
    expect(tx).not.toContain(FARMER); expect(h).not.toContain(SELLER_UUID);
    expect(tx).toContain('Listed at ₹2,520.00 per quintal · 18 quintal available');
    expect(tx).toContain('Now on the table: 12 quintal = ₹29,880.00');
    expect(h).toContain(`href="/${SLUG}/sellers"`);
  });
  it('the clock from the read: respond by, the hours per round and the ceiling', async () => {
    const h = await thread(OFF.countered);
    expect(h).toContain('data-kv-clock="read"');
    expect(text(h)).toMatch(/Respond by .+\. \(48 hours per round; the negotiation ends by .+\.\)/);
  });
  it('no "Message seller"; the mandi, the AI hint, the farmer, notes, checkout-from-offer and "offers don\'t reserve" refused by name', async () => {
    const h = await thread(OFF.countered);
    expect(text(h)).not.toMatch(/Message the seller/i);
    for (const k of store3bRefusalKeys('offer')) expect(text(h)).toContain(en[k]);
    expect(text(h)).toContain(en['store3b.thread.oneKey']);
  });
  it('the `offers` flag OFF → the honest state and no offer read', async () => {
    C.flags = { ...C.flags, offers: false };
    const h = await thread(OFF.countered);
    expect(h).toContain('data-kv-state="flag-off"');
    expect(C.calls.filter((c) => c[0] === 'offers.get')).toEqual([]);
  });
  it('a stranger\'s id → 404; a load error → Retry (not a 404)', async () => {
    await expect(thread('0211c000-0000-7000-8000-0000000000ff')).rejects.toThrow('NEXT_NOT_FOUND');
    C.offers[OFF.expired] = new Error('down');
    expect(await thread(OFF.expired)).toContain('data-kv-retry="reload"');
  });
  it('the platform /offers/[id] is a door carrying the chain\'s query', async () => {
    await expect(PlatformOfferDoor({ params: { id: OFF.countered }, searchParams: { act: 'accept' } })).rejects.toThrow(`REDIRECT /${SLUG}/offers/${OFF.countered}?act=accept`);
  });
});

describe('STORE-3b · the acts (Server Actions): one key per act, named outcomes', () => {
  it('accept → offers.accept(id, the minted key) → ?ok=accepted', async () => {
    expect(await redirectOf(acceptOfferAction(form({ slug: SLUG, id: OFF.countered, key: KEY })))).toBe(`REDIRECT /${SLUG}/offers/${OFF.countered}?ok=accepted`);
    expect(C.calls).toContainEqual(['offers.accept', OFF.countered, KEY]);
  });
  it('accept refused OFFER_STOCK_SHORT → back to the confirm, the same key, the remainder', async () => {
    C.fail['offers.accept'] = { code: 'OFFER_STOCK_SHORT', status: 409, details: { available: '4.500' } };
    expect(await redirectOf(acceptOfferAction(form({ slug: SLUG, id: OFF.countered, key: KEY }))))
      .toBe(`REDIRECT /${SLUG}/offers/${OFF.countered}?act=accept&error=stock_short&k=${encodeURIComponent(KEY)}&av=4.500`);
  });
  it('a 404 while the store\'s `offers` flag is OFF → flag_off (re-read, never guessed)', async () => {
    C.fail['offers.accept'] = { code: 'NOT_FOUND', status: 404 };
    C.flags = { ...C.flags, offers: false };
    expect(await redirectOf(acceptOfferAction(form({ slug: SLUG, id: OFF.countered, key: KEY })))).toContain('error=flag_off');
  });
  it('counter → the typed price parsed by the offer\'s (listing\'s) currency, sent with the key', async () => {
    const k = 'counter:0211c000-0000-7000-8000-000000000002:k2';
    expect(await redirectOf(counterOfferAction(form({ slug: SLUG, id: OFF.countered, key: k, price: '2470.5' })))).toBe(`REDIRECT /${SLUG}/offers/${OFF.countered}?ok=countered`);
    expect(C.calls).toContainEqual(['offers.counter', OFF.countered, '247050', k]);
    C.offers[OFF.countered] = OFFER(OFF.countered, { currencyCode: 'JPY' });
    expect(await redirectOf(counterOfferAction(form({ slug: SLUG, id: OFF.countered, key: k, price: '2470.5' })))).toContain('error=invalid_price');
  });
  it('decline needs one of the six reasons; with one → offers.reject(id, key, reason)', async () => {
    const k = 'decline:0211c000-0000-7000-8000-000000000002:k3';
    expect(await redirectOf(declineOfferAction(form({ slug: SLUG, id: OFF.countered, key: k })))).toContain('error=reason_required');
    expect(await redirectOf(declineOfferAction(form({ slug: SLUG, id: OFF.countered, key: k, reason: 'lot_committed' })))).toBe(`REDIRECT /${SLUG}/offers/${OFF.countered}?ok=declined`);
    expect(C.calls).toContainEqual(['offers.reject', OFF.countered, k, 'lot_committed']);
  });
});

// (C4 — the order page of an offer order — is pinned in order-detail.render.test.tsx, on the 3a fixtures that page renders with.)
void React;
