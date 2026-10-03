// modules/offers/__tests__/order-from-offer-created.handler.spec.ts · unit: orders.order_from_offer_created
// → offer converted. Mocks the repo; asserts conversion, idempotency, and the not-accepted guard.
import { OrderFromOfferCreatedHandler } from '../events/handlers/order-from-offer-created.handler';
import { ListingOffer } from '../domain/listing-offer.entity';
import { OfferEventType } from '../domain/offers.events';

const tenantId = 't1', offerId = 'of1', orderId = 'or1';
const acceptedOffer = () => { const o = ListingOffer.make({ id: offerId, tenantId, listingId: 'l1', buyerUserId: 'b1', quantity: '10', offeredPriceMinor: 90000n, expiresAt: new Date('2030-01-01T00:00:00Z') }); o.accept('seller', new Date('2026-06-01T00:00:00Z')); o.pullEvents(); return o; };
const evt = () => ({ id: '1', tenantId, aggregateType: 'order', aggregateId: orderId, eventType: 'orders.order_from_offer_created', payload: { v: 1, offerId, orderId } });

function harness(offer: ListingOffer | null) {
  const repo = { getForUpdate: jest.fn().mockResolvedValue(offer), update: jest.fn().mockResolvedValue(undefined) } as any;
  const outbox = { write: jest.fn().mockResolvedValue(undefined) } as any;
  // HOTFIX-2: the lock + conversion run in kv_app's unit of work (kv_relay holds no privilege on listing_offers); the fake runs fn
  const uow = { run: jest.fn(async (_t: string, fn: (x: any) => Promise<unknown>) => fn({ query: jest.fn() })) } as any;
  return { h: new OrderFromOfferCreatedHandler(repo, outbox, uow), repo, outbox, uow, tx: { query: jest.fn() } as any };
}

describe('OrderFromOfferCreatedHandler', () => {
  it('converts an accepted offer (converted_order_id set) and emits offer_converted', async () => {
    const { h, repo, outbox, tx } = harness(acceptedOffer());
    await h.handle(evt() as any, tx);
    expect(repo.update).toHaveBeenCalledTimes(1);
    const updated = repo.update.mock.calls[0][1];
    expect(updated.status).toBe('converted');
    expect(updated.toProps().convertedOrderId).toBe(orderId);
    expect(outbox.write.mock.calls.map((c: any[]) => c[1].eventType)).toContain(OfferEventType.Converted);
  });

  it('is idempotent — an already-converted offer is a no-op', async () => {
    const o = acceptedOffer(); o.convert(orderId); o.pullEvents();
    const { h, repo } = harness(o);
    await h.handle(evt() as any, { query: jest.fn() } as any);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('skips a non-accepted offer (defensive) and an unknown offer', async () => {
    const open = ListingOffer.make({ id: offerId, tenantId, listingId: 'l1', buyerUserId: 'b1', quantity: '1', offeredPriceMinor: 1000n, expiresAt: new Date('2030-01-01T00:00:00Z') });
    const a = harness(open); await a.h.handle(evt() as any, a.tx); expect(a.repo.update).not.toHaveBeenCalled();
    const b = harness(null); await b.h.handle(evt() as any, b.tx); expect(b.repo.update).not.toHaveBeenCalled();
  });
});
