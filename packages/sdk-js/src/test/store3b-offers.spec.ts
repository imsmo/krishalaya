// @krishalaya/sdk-js · PC-56 STORE-3b — the offers wave's contract, pinned with an injected fake fetch (no network): the bounded counts, the
// counter / accept / reject with an OPTIONAL trailing Idempotency-Key (existing two-argument callers unchanged — web-tenant, mobile), the
// decline reason in the body only when given, the new read fields, and the refusals as a closed, named list.
import { createClient } from '../client';
import { OFFER_STATUSES, OFFER_DECLINE_REASONS, OFFER_REFUSAL_CODES } from '../types';
import type { OfferCounts, ListingOffer, OrderDetail } from '../types';

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (call: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const fn = (async (url: unknown, init: unknown) => {
    const call = { url: String(url), init: (init ?? {}) as RequestInit }; calls.push(call);
    const r = handler(call); const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const hdr = (c: Call) => (c.init.headers ?? {}) as Record<string, string>;
const client = (fn: typeof fetch) => createClient({ baseUrl: 'https://api.test', getToken: () => 'tok', tenantSlug: 'anand-fpo', fetchImpl: fn });

describe('PC-56 STORE-3b · SDK offers', () => {
  it('counts() reads the bounded per-status counts', async () => {
    const counts: OfferCounts = { all: { count: 9, capped: false }, open: { count: 2, capped: false }, countered: { count: 1, capped: false },
      accepted: { count: 0, capped: false }, rejected: { count: 1, capped: false }, expired: { count: 100, capped: true }, converted: { count: 4, capped: false } };
    const { fn, calls } = fakeFetch(() => ({ body: { data: counts } }));
    expect(await client(fn).offers.counts()).toEqual(counts);
    expect([calls[0].init.method, new URL(calls[0].url).pathname]).toEqual(['GET', '/v1/offers/counts']);
  });
  it('counter / accept / reject carry the key when given and none when not (two-argument callers unchanged)', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 201, body: { data: { offerId: 'o1' } } }));
    await client(fn).offers.counter('o1', '249000', 'k-c');
    await client(fn).offers.accept('o1', 'k-a');
    await client(fn).offers.reject('o1', 'k-r', 'lot_committed');
    await client(fn).offers.counter('o1', '249000');
    await client(fn).offers.accept('o1');
    await client(fn).offers.reject('o1');
    expect(calls.map((c) => [new URL(c.url).pathname, hdr(c)['idempotency-key'] ?? null])).toEqual([
      ['/v1/offers/o1/counter', 'k-c'], ['/v1/offers/o1/accept', 'k-a'], ['/v1/offers/o1/reject', 'k-r'],
      ['/v1/offers/o1/counter', null], ['/v1/offers/o1/accept', null], ['/v1/offers/o1/reject', null]]);
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ reasonCode: 'lot_committed' });
    expect(JSON.parse(String(calls[5].init.body))).toEqual({});
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ priceMinor: '249000' });
  });
  it('the read\'s new fields are typed (and optional — an old read still satisfies the type); OrderDetail links back to its offer', () => {
    const old: ListingOffer = { offerId: 'o', listingId: 'l', buyerUserId: 'b', quantity: '12.000', offeredPriceMinor: '1', counterPriceMinor: null, round: 1, status: 'open', currencyCode: 'INR' };
    const now: ListingOffer = { ...old, yourTurn: true, allowedActs: ['accept', 'counter', 'decline'], offerValueMinor: '2928000', respondBy: '2026-10-17T06:00:00.000Z',
      roundTtlHours: 48, maxLifeEndsAt: '2026-10-29T06:00:00.000Z', rounds: [{ round: 1, party: 'buyer', act: 'offer', priceMinor: '244000', at: '2026-10-15T06:00:00.000000Z' }],
      organisation: { slug: 'anand-fpo', name: 'Anand FPO' }, conversion: null, declineReasonCode: null };
    const d: Pick<OrderDetail, 'offerId' | 'auctionId'> = { offerId: 'o', auctionId: null };
    expect([old.yourTurn, now.rounds?.length, d.offerId]).toEqual([undefined, 1, 'o']);
  });
  it('the statuses, the six decline reasons and the refusals are closed, named lists', () => {
    expect(OFFER_STATUSES).toEqual(['open', 'countered', 'accepted', 'rejected', 'expired', 'converted']);
    expect(OFFER_DECLINE_REASONS).toEqual(['price', 'lot_committed', 'quantity', 'timing', 'changed_mind', 'other']);
    expect(OFFER_REFUSAL_CODES).toContain('OFFER_STOCK_SHORT');
    expect(OFFER_REFUSAL_CODES).toContain('OFFER_NOT_YOUR_TURN');
    expect(OFFER_REFUSAL_CODES).toHaveLength(11);
  });
});
