// modules/offers/__tests__/listing-offer.service.spec.ts · pure-domain unit tests: the offer status
// state machine (Law 5) + the ListingOffer aggregate (turn model, counter ping-pong, accept price,
// reject/withdraw, expiry, conversion). No infra — the service's UoW/outbox/authz are covered by the
// integration spec; here we pin the negotiation invariants.
import { canTransition, isNegotiable, isTerminal, IllegalOfferTransitionError, OFFER_STATUSES, OfferStatus } from '../domain/listing-offer.state';
import { ListingOffer } from '../domain/listing-offer.entity';
import { OfferEventType } from '../domain/offers.events';
import { InvalidOfferError, OfferNotNegotiableError, NotYourTurnError, OfferExpiredError } from '../domain/offers.errors';

const FUTURE = new Date('2030-01-01T00:00:00Z');
const NOW = new Date('2026-06-01T00:00:00Z');
// PC-56 STORE-3b · B1: a counter now carries the new round's deadline and the negotiation's ceiling (store3b-offer-rules.spec.ts pins the clock)
const CLK = { respondBy: FUTURE, maxLifeEndsAt: FUTURE };
const make = (over: any = {}) => ListingOffer.make({
  id: 'o1', tenantId: 't1', listingId: 'l1', buyerUserId: 'buyer1',
  quantity: '10', offeredPriceMinor: 100000n, expiresAt: FUTURE, now: NOW, ...over,
});

describe('offer.state machine', () => {
  it('allows the documented transitions, forbids illegal ones', () => {
    expect(canTransition('open', 'countered')).toBe(true);
    expect(canTransition('open', 'accepted')).toBe(true);
    expect(canTransition('countered', 'countered')).toBe(true);
    expect(canTransition('accepted', 'converted')).toBe(true);
    expect(canTransition('open', 'converted')).toBe(false);
    expect(canTransition('rejected', 'open')).toBe(false);
    expect(isNegotiable('open')).toBe(true); expect(isNegotiable('countered')).toBe(true); expect(isNegotiable('accepted')).toBe(false);
    expect(isTerminal('rejected')).toBe(true); expect(isTerminal('expired')).toBe(true); expect(isTerminal('converted')).toBe(true);
  });
  it('covers every status without throwing', () => { for (const s of OFFER_STATUSES) expect(() => canTransition(s, 'rejected' as OfferStatus)).not.toThrow(); });
  it('IllegalOfferTransitionError carries from/to + 409', () => {
    const e = new IllegalOfferTransitionError('rejected', 'open');
    expect(e.code).toBe('OFFER_ILLEGAL_TRANSITION'); expect((e as any).status ?? (e as any).httpStatus ?? 409).toBeTruthy();
  });
});

describe('ListingOffer.make', () => {
  it('rejects bad quantity, non-positive price, and a past expiry', () => {
    expect(() => make({ quantity: '0' })).toThrow(InvalidOfferError);
    expect(() => make({ quantity: '1.2345' })).toThrow(InvalidOfferError);   // > 3 decimals
    expect(() => make({ offeredPriceMinor: 0n })).toThrow(InvalidOfferError);
    expect(() => make({ expiresAt: new Date(NOW.getTime() - 1000) })).toThrow(InvalidOfferError);
  });
  it('starts open at round 1 (buyer made it → seller\'s turn) and emits offer_made', () => {
    const o = make();
    expect(o.status).toBe('open'); expect(o.round).toBe(1);
    expect(o.isSellersTurn()).toBe(true); expect(o.isBuyersTurn()).toBe(false);
    expect(o.pullEvents().map((e) => e.type)).toContain(OfferEventType.Made);
  });
});

describe('turn model + counter ping-pong', () => {
  it('seller counters → round 2, countered, now the buyer\'s turn; counter price is on the buyer\'s table', () => {
    const o = make(); o.pullEvents();
    o.counter('seller', 90000n, NOW, CLK);
    expect(o.status).toBe('countered'); expect(o.round).toBe(2);
    expect(o.isBuyersTurn()).toBe(true); expect(o.isSellersTurn()).toBe(false);
    expect(o.priceOnTableFor('buyer')).toBe(90000n);
    expect(o.pullEvents().map((e) => e.type)).toContain(OfferEventType.Countered);
  });
  it('buyer re-counters → round 3, seller\'s turn, offered price replaced, stale seller counter cleared', () => {
    const o = make(); o.counter('seller', 90000n, NOW, CLK);
    o.counter('buyer', 95000n, NOW, CLK);
    expect(o.round).toBe(3); expect(o.isSellersTurn()).toBe(true);
    expect(o.priceOnTableFor('seller')).toBe(95000n);          // buyer's new offered price
    expect(o.toProps().counterPriceMinor).toBeNull();
  });
  it('a party cannot act out of turn', () => {
    const o = make();                              // open, seller's turn
    expect(() => o.counter('buyer', 80000n, NOW, CLK)).toThrow(NotYourTurnError);
    expect(() => o.accept('buyer', NOW)).toThrow(NotYourTurnError);
    o.counter('seller', 90000n, NOW, CLK);              // countered, buyer's turn
    expect(() => o.counter('seller', 85000n, NOW, CLK)).toThrow(NotYourTurnError);
  });
});

describe('accept resolves the price on the table', () => {
  it('seller accepts the buyer\'s open offer → agreed = offered price', () => {
    const o = make();
    o.accept('seller', NOW);
    expect(o.status).toBe('accepted'); expect(o.agreedPriceMinor).toBe(100000n);
    const ev = o.pullEvents().find((e) => e.type === OfferEventType.Accepted)!;
    expect(ev.payload.agreedPriceMinor).toBe('100000');
  });
  it('buyer accepts the seller\'s counter → agreed = counter price', () => {
    const o = make(); o.counter('seller', 90000n, NOW, CLK);
    o.accept('buyer', NOW);
    expect(o.agreedPriceMinor).toBe(90000n);
  });
});

describe('reject, expiry, conversion', () => {
  it('either party may withdraw/decline while live; not when terminal', () => {
    const a = make(); a.reject('buyer', NOW); expect(a.status).toBe('rejected');
    expect(() => a.reject('seller', NOW)).toThrow(OfferNotNegotiableError);
    const b = make(); b.counter('seller', 90000n, NOW, CLK); b.reject('seller', NOW); expect(b.status).toBe('rejected');
  });
  it('expire only fires after expires_at; rejects acting on an expired offer', () => {
    const o = make({ expiresAt: new Date(NOW.getTime() + 1000) });
    expect(() => o.expire(NOW)).toThrow(InvalidOfferError);                 // not yet due
    const later = new Date(NOW.getTime() + 2000);
    expect(() => o.accept('seller', later)).toThrow(OfferExpiredError);     // live but past expiry
    o.expire(later); expect(o.status).toBe('expired');
    expect(() => o.expire(later)).toThrow(OfferNotNegotiableError);
  });
  it('an accepted offer can be converted (order created downstream); converting a live offer is illegal', () => {
    const o = make(); o.accept('seller', NOW); o.pullEvents();
    o.convert('order-123');
    expect(o.status).toBe('converted'); expect(o.toProps().convertedOrderId).toBe('order-123');
    expect(o.pullEvents().map((e) => e.type)).toContain(OfferEventType.Converted);
    const live = make();
    expect(() => live.convert('order-999')).toThrow(IllegalOfferTransitionError);
  });
});
