// modules/offers/__tests__/store3b-offer-rules.spec.ts · PC-56 STORE-3b — the negotiation's rules, unit (no infra; the live proof is
// src/__tests__/store3b-offers.integration.spec.ts):
//   • THE CLOCK (founder D1): make's default and its bound (OFFER_EXPIRY_TOO_LATE); a counter RESETS the round's deadline; a counter past the
//     negotiation's ceiling is OFFER_MAX_LIFE; the settings' fallbacks are named;
//   • THE ACCEPT'S GUARDS (D2): the turn / clock first (nothing reserved for an accept that cannot happen); a paused listing, a suspended seller
//     and a short stock refused by name; a good accept reserves the offer's quantity through the listing service and says so in the event;
//   • THE ROUNDS WRITER (D3): one history row per act, in the act's transaction (offer · counter · accept · decline · expire);
//   • THE DECLINE REASON (D3): an unknown code 422, a known one recorded with its side;
//   • THE READ: turn / acts for the caller, the synthesised round 1, the server value; the µs keyset (F-20).
import { ListingOffer } from '../domain/listing-offer.entity';
import { OfferEventType } from '../domain/offers.events';
import { NotYourTurnError } from '../domain/offers.errors';
import { makeExpiry, counterClock, maxLifeEndsAt, hoursOf, latestRespondBy, OFFER_ROUND_TTL_FALLBACK_H, OFFER_MAX_LIFE_FALLBACK_H } from '../domain/offer-clock';
import { allowedActsFor, turnOf, roundsOf, offerValueMinor, conversionOf, OFFER_COUNT_KEYS } from '../domain/offer-read';
import { ListingOfferService } from '../services/listing-offer.service';
import { ListingOfferRepository } from '../repositories/listing-offer.repository';
import { InsufficientStockError, ListingNotEditableError } from '../../listings/domain/listing.errors';
import { decodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';

const H = 3_600_000;
const T0 = new Date('2026-10-15T06:00:00.000Z');
const CLOCK = { roundTtlHours: 48, maxLifeHours: 336 };
const at = (h: number) => new Date(T0.getTime() + h * H);
const offer = (over: Partial<Parameters<typeof ListingOffer.rehydrate>[0]> = {}) => ListingOffer.rehydrate({
  id: '0211a000-0000-7000-8000-000000000001', tenantId: 't1', listingId: 'l1', buyerUserId: 'buyer1', quantity: '12.000',
  offeredPriceMinor: 244_000n, counterPriceMinor: null, round: 1, status: 'open', expiresAt: at(48), convertedOrderId: null, createdAt: T0,
  currencyCode: 'INR', ...over,
});

describe('STORE-3b · the offer clock (founder D1)', () => {
  it('make: no expiresAt → now + the round TTL; within it → kept; later → OFFER_EXPIRY_TOO_LATE {max}', () => {
    expect(makeExpiry(T0, CLOCK).toISOString()).toBe(at(48).toISOString());
    expect(makeExpiry(T0, CLOCK, at(10)).toISOString()).toBe(at(10).toISOString());
    try { makeExpiry(T0, CLOCK, at(49)); throw new Error('not refused'); }
    catch (e) { expect([(e as { code?: string }).code, (e as { details?: { max?: string } }).details?.max]).toEqual(['OFFER_EXPIRY_TOO_LATE', at(48).toISOString()]); }
  });
  it('a counter RESETS the clock: the new round runs a full TTL from the counter', () => {
    const o = offer();
    o.counter('seller', 249_000n, at(30), counterClock(at(30), o.firstOfferedAt, CLOCK));
    expect(o.expiresAt.toISOString()).toBe(at(78).toISOString());
    expect(o.toProps().round).toBe(2);
  });
  it('a counter whose round would pass the ceiling (max life from the FIRST offer) → OFFER_MAX_LIFE {endsAt}; nothing changes', () => {
    const o = offer({ round: 2, status: 'countered', counterPriceMinor: 250_000n, expiresAt: at(320) });
    expect(() => o.counter('buyer', 246_000n, at(300), counterClock(at(300), o.firstOfferedAt, CLOCK))).toThrow(expect.objectContaining({ code: 'OFFER_MAX_LIFE', details: { endsAt: at(336).toISOString() } }));
    expect([o.round, o.expiresAt.toISOString()]).toEqual([2, at(320).toISOString()]);
    expect(maxLifeEndsAt(T0, CLOCK).toISOString()).toBe(at(336).toISOString());
    expect(latestRespondBy(at(300), T0, CLOCK).toISOString()).toBe(at(336).toISOString());
  });
  it('the settings are read, never assumed: a malformed value is null (the repository then uses the NAMED fallback and logs)', () => {
    expect([hoursOf('48'), hoursOf(336), hoursOf('0'), hoursOf('x'), hoursOf(null), hoursOf('2.5')]).toEqual([48, 336, null, null, null, null]);
    expect([OFFER_ROUND_TTL_FALLBACK_H, OFFER_MAX_LIFE_FALLBACK_H]).toEqual([48, 336]);
  });
});

describe('STORE-3b · the read (B6) — turn, acts, thread, value', () => {
  it('the turn is the entity\'s parity rule; acts only on the caller\'s turn, live, before the deadline', () => {
    const o = { status: 'open' as const, round: 1, expiresAt: at(48) };
    expect(turnOf('open', 1)).toBe('seller'); expect(turnOf('countered', 2)).toBe('buyer'); expect(turnOf('accepted', 2)).toBeNull();
    expect(allowedActsFor('seller', o, at(1))).toEqual(['accept', 'counter', 'decline']);
    expect(allowedActsFor('buyer', o, at(1))).toEqual([]);
    expect(allowedActsFor('seller', o, at(48))).toEqual([]);                              // the round's deadline has passed
    expect(allowedActsFor('buyer', { status: 'converted', round: 2, expiresAt: at(48) }, at(1))).toEqual([]);
    for (const r of [1, 2, 3, 4]) {                                                       // parity with the entity's own rule
      const e = offer({ round: r, status: r === 1 ? 'open' : 'countered', counterPriceMinor: r % 2 === 0 ? 250_000n : null });
      expect([r, turnOf(e.status, r)]).toEqual([r, e.isSellersTurn() ? 'seller' : 'buyer']);
    }
  });
  it('an offer made before 0211 has no stored rounds → round 1 is synthesised from the offer row', () => {
    expect(roundsOf([], { offeredPriceMinor: 244_000n, createdAt: T0, round: 2 })).toEqual([{ round: 1, party: 'buyer', act: 'offer', priceMinor: '244000', at: T0.toISOString() }]);
    const stored = [{ round: 1, party: 'buyer' as const, act: 'offer' as const, priceMinor: '1', at: 'x' }];
    expect(roundsOf(stored, { offeredPriceMinor: 244_000n, createdAt: T0, round: 1 })).toEqual(stored);
  });
  it('the server value: quantity × the price on the table, the order line\'s floor (12.345 × 90000 = 1111050)', () => {
    expect(offerValueMinor('12.345', 90_000n)).toBe('1111050');
    expect(offerValueMinor('12', 244_000n)).toBe('2928000');
    expect(offer({ round: 2, status: 'countered', counterPriceMinor: 249_000n }).currentPriceMinor).toBe(249_000n);
    expect(offer().currentPriceMinor).toBe(244_000n);
    expect([conversionOf('accepted'), conversionOf('converted'), conversionOf('open')]).toEqual(['creating', 'converted', null]);
    expect(OFFER_COUNT_KEYS).toEqual(['all', 'open', 'countered', 'accepted', 'rejected', 'expired', 'converted']);
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------------ */
/* the service over fakes: the accept guards, the rounds writer, the decline reason                                                      */
/* ------------------------------------------------------------------------------------------------------------------------------------ */
const LISTING = { id: 'l1', sellerUserId: 'seller1', status: 'published', title: 'Lokwan wheat', unitCode: 'quintal', currencyCode: 'INR', minOrderQty: 1, quantityAvailable: 18 };
function world(o: ListingOffer, opts: { listing?: Record<string, unknown> | null; suspended?: boolean; reserve?: () => Promise<unknown> } = {}) {
  const rounds: Array<Record<string, unknown>> = [];
  const repo = {
    getForUpdate: jest.fn(async () => o), getById: jest.fn(async () => o), update: jest.fn(async () => undefined), insert: jest.fn(async () => undefined),
    clock: jest.fn(async () => CLOCK), insertRound: jest.fn(async (_tx: unknown, r: Record<string, unknown>) => { rounds.push(r); }),
    roundsFor: jest.fn(async () => new Map()), organisationOf: jest.fn(async () => ({ slug: 'anand-fpo', name: 'Anand FPO' })),
    orderStatusesForBuyer: jest.fn(async () => new Map()),
    declineReasonActiveTx: jest.fn(async (_tx: unknown, c: string) => ['price', 'lot_committed', 'quantity', 'timing', 'changed_mind', 'other'].includes(c)),
  };
  const listings = {
    getById: jest.fn(async () => ('listing' in opts ? opts.listing : LISTING)),
    reserveInTx: jest.fn(opts.reserve ?? (async () => ({ available: '6.000', soldOut: false }))),
    invalidate: jest.fn(async () => undefined),
  };
  const tx = { query: jest.fn(async () => ({ rows: [{ suspended: opts.suspended === true }] })) };
  const uow = { run: async (_t: string, fn: (tx: unknown) => Promise<unknown>) => fn(tx) };
  const outbox = { write: jest.fn(async () => undefined) };
  const idem = { remember: async (_k: string, _u: string, _e: string, fn: () => Promise<unknown>) => fn() };
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  const svc = new ListingOfferService(uow as never, outbox as never, idem as never, metrics as never, listings as never, repo as never);
  return { svc, repo, listings, rounds, outbox, tx };
}
const BUYER = { userId: 'buyer1', canModerate: false };
const SELLER = { userId: 'seller1', canModerate: false };
const codeOf = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
const NOW_LIVE = { expiresAt: new Date(Date.now() + 10 * H), createdAt: new Date(Date.now() - H) };

describe('STORE-3b · the accept (founder D2): the turn first, then the listing re-checked and the quantity RESERVED', () => {
  it('not the caller\'s turn → OFFER_NOT_YOUR_TURN and NOTHING is reserved', async () => {
    const w = world(offer(NOW_LIVE));                                                    // round 1: the seller's turn
    expect(await codeOf(w.svc.accept('t1', BUYER, 'o'))).toBe('OFFER_NOT_YOUR_TURN');
    expect(w.listings.reserveInTx).not.toHaveBeenCalled();
    expect(new NotYourTurnError('buyer').code).toBe('OFFER_NOT_YOUR_TURN');
  });
  it('a paused listing → OFFER_LISTING_UNAVAILABLE {status}; a suspended seller → OFFER_SELLER_UNAVAILABLE; nothing reserved', async () => {
    const a = world(offer(NOW_LIVE), { listing: { ...LISTING, status: 'paused' } });
    expect(await codeOf(a.svc.accept('t1', SELLER, 'o'))).toBe('OFFER_LISTING_UNAVAILABLE');
    const b = world(offer(NOW_LIVE), { suspended: true });
    expect(await codeOf(b.svc.accept('t1', SELLER, 'o'))).toBe('OFFER_SELLER_UNAVAILABLE');
    for (const w of [a, b]) expect(w.listings.reserveInTx).not.toHaveBeenCalled();
  });
  it('the LOCKED remainder short of the quantity → OFFER_STOCK_SHORT {available} (decimal text); the locked row stopped selling → OFFER_LISTING_UNAVAILABLE', async () => {
    const a = world(offer(NOW_LIVE), { reserve: async () => { throw new InsufficientStockError(12, 4.5); } });
    try { await a.svc.accept('t1', SELLER, 'o'); throw new Error('not refused'); }
    catch (e) { expect([(e as { code?: string }).code, (e as { details?: unknown }).details]).toEqual(['OFFER_STOCK_SHORT', { available: '4.500' }]); }
    const b = world(offer(NOW_LIVE), { reserve: async () => { throw new ListingNotEditableError('l1', 'sold_out'); } });
    expect(await codeOf(b.svc.accept('t1', SELLER, 'o'))).toBe('OFFER_LISTING_UNAVAILABLE');
    expect(a.rounds).toEqual([]);
  });
  it('a good accept reserves the OFFER\'s quantity in the accept transaction, writes the accept round, says stockReserved in the event, drops the listing cache', async () => {
    const w = world(offer(NOW_LIVE));
    const r = await w.svc.accept('t1', SELLER, 'o');
    expect(w.listings.reserveInTx).toHaveBeenCalledWith(w.tx, 't1', 'l1', '12.000');
    expect(w.rounds).toEqual([expect.objectContaining({ act: 'accept', party: 'seller', round: 1, priceMinor: 244_000n })]);
    const ev = (w.outbox.write.mock.calls as unknown as Array<[unknown, { eventType: string; payload: Record<string, unknown> }]>).find((c) => c[1].eventType === OfferEventType.Accepted)![1];
    expect(ev.payload).toMatchObject({ stockReserved: true, agreedPriceMinor: '244000', quantity: '12.000' });
    expect(w.listings.invalidate).toHaveBeenCalledWith('t1', 'l1');
    expect([r.status, r.conversion, r.convertedOrderId, r.offerValueMinor]).toEqual(['accepted', 'creating', null, '2928000']);
  });
});

describe('STORE-3b · the rounds writer and the decline reason (founder D3)', () => {
  it('a counter writes ONE counter row at the new round, with its price, and resets the clock from the setting', async () => {
    const w = world(offer(NOW_LIVE));
    const r = await w.svc.counter('t1', SELLER, 'o', '249000');
    expect(w.rounds).toEqual([expect.objectContaining({ act: 'counter', party: 'seller', round: 2, priceMinor: 249_000n })]);
    expect(new Date(r.respondBy).getTime() - Date.now()).toBeGreaterThan(47.9 * H);
    expect([r.yourTurn, r.allowedActs, r.roundTtlHours]).toEqual([false, [], 48]);
  });
  it('a decline with an unknown code → 422 OFFER_DECLINE_REASON_UNKNOWN and nothing written; a known code → recorded with its side + a decline row', async () => {
    const a = world(offer({ ...NOW_LIVE, round: 2, status: 'countered', counterPriceMinor: 250_000n }));
    try { await a.svc.reject('t1', BUYER, 'o', 'holding_for_auction'); throw new Error('not refused'); }
    catch (e) { expect([(e as { code?: string }).code, (e as { httpStatus?: number }).httpStatus]).toEqual(['OFFER_DECLINE_REASON_UNKNOWN', 422]); }
    expect([a.rounds, a.repo.update.mock.calls.length]).toEqual([[], 0]);
    const b = world(offer({ ...NOW_LIVE, round: 2, status: 'countered', counterPriceMinor: 250_000n }));
    const r = await b.svc.reject('t1', BUYER, 'o', 'lot_committed');
    expect([r.status, r.declineReasonCode, r.declinedBy]).toEqual(['rejected', 'lot_committed', 'buyer']);
    expect(b.rounds).toEqual([expect.objectContaining({ act: 'decline', party: 'buyer', round: 2, priceMinor: null })]);
  });
  it('the expiry clock writes an `expire` row by the system', async () => {
    const w = world(offer({ expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 49 * H) }));
    expect(await w.svc.expire('t1', 'o')).toBe(true);
    expect(w.rounds).toEqual([expect.objectContaining({ act: 'expire', party: 'system', priceMinor: null })]);
  });
  it('the read names the organisation, the listing and the server value — never a person', async () => {
    const w = world(offer(NOW_LIVE));
    const r = await w.svc.getById('t1', BUYER, 'o');
    expect([r.listingTitle, r.unitCode, r.organisation, r.offerValueMinor, r.yourTurn]).toEqual(['Lokwan wheat', 'quintal', { slug: 'anand-fpo', name: 'Anand FPO' }, '2928000', false]);
    expect(JSON.stringify(r)).not.toContain('seller1');
  });
});

describe('STORE-3b · B8 the offers keyset is microsecond-exact (survey F-20)', () => {
  function fakeReplica() { const exec = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }; return { provider: { forTenant: () => exec } as never, exec }; }
  it('the cursor is compared as (created_at, id) against the µs instant, never a millisecond Date', async () => {
    const { provider, exec } = fakeReplica();
    await new ListingOfferRepository(provider).listForBuyer('t1', 'b1', { limit: 20, cursor: { ts: '2026-10-15T06:00:00.123456Z', id: '0211a000-0000-7000-8000-000000000001' } });
    const [sql, params] = exec.query.mock.calls[0];
    expect(sql).toMatch(/\(created_at, id\) < \(\$3::timestamptz, \$4::uuid\)/);
    expect(sql).toMatch(/to_char\(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS\.US"Z"'\) AS created_at_us/);
    expect(params).toEqual(['t1', 'b1', '2026-10-15T06:00:00.123456Z', '0211a000-0000-7000-8000-000000000001', 20]);
  });
  it('a pre-3b millisecond cursor is "no cursor" (page one), never a guess', () => {
    const legacy = Buffer.from('2026-10-15T06:00:00.123Z|0211a000-0000-7000-8000-000000000001').toString('base64');
    expect(decodeKeyset(legacy, UUID_RE)).toBeUndefined();
  });
});
