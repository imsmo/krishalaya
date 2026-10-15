// modules/orders/__tests__/offer-accepted.handler.spec.ts · unit: the offers.offer_accepted → order
// handler. Pure mocks for repo/listing/flags/outbox; asserts the mapping, idempotency, and guards.
// PC-56 STORE-3b · B2 / B3: + the kv_app unit of work, the shared placement charges (member override + the frozen commission), the reservation
// marker from the event, the decimal quantity, and the release + audit when the order can never be created.
import { OfferAcceptedHandler } from '../events/handlers/offer-accepted.handler';
import { OrderEventType } from '../domain/orders.events';

const tenantId = 't1', offerId = 'of1', listingId = 'l1', buyer = 'b1', seller = 's1';
const listing = { sellerUserId: seller, productId: 'p1', title: 'Wheat', unitCode: 'quintal', currencyCode: 'INR', status: 'published' };
const evt = (over: any = {}) => ({ id: '1', tenantId, aggregateType: 'listing_offer', aggregateId: offerId, eventType: 'offers.offer_accepted', payload: { v: 1, offerId, listingId, buyerUserId: buyer, agreedPriceMinor: '90000', quantity: '10', ...over } });

function harness(opts: { exists?: boolean; listing?: any; paymentOn?: boolean; flagsOn?: string[]; buyerCommission?: bigint; benefit?: any } = {}) {
  const repo = { existsForOffer: jest.fn().mockResolvedValue(opts.exists ?? false), insertGraph: jest.fn().mockResolvedValue(undefined) } as any;
  const listings = { getById: jest.fn().mockResolvedValue('listing' in opts ? opts.listing : listing), releaseInTx: jest.fn().mockResolvedValue(undefined), invalidate: jest.fn().mockResolvedValue(undefined) } as any;
  const on = new Set([...(opts.paymentOn ? ['online_payments'] : []), ...(opts.flagsOn ?? [])]);
  const flags = { isEnabled: jest.fn().mockImplementation(async (k: string) => on.has(k)) } as any;
  const outbox = { write: jest.fn().mockResolvedValue(undefined) } as any;
  const metrics = { inc: jest.fn(), timing: jest.fn() } as any;
  const tx = { query: jest.fn() } as any;
  const uow = { run: jest.fn().mockImplementation(async (_t: string, fn: (tx: any) => Promise<unknown>) => fn(tx)) } as any;
  const memberships = { checkoutBenefits: jest.fn().mockResolvedValue(opts.benefit ?? null) } as any;
  const bc = opts.buyerCommission ?? 0n;
  const commission = { freezeAtPlacement: jest.fn().mockResolvedValue({ snapshot: { ruleId: 'r1' }, buyerCommissionMinor: bc,
    chargeEntry: bc > 0n ? { code: 'buyer_commission', amountMinor: bc.toString() } : null }) } as any;
  const audit = { write: jest.fn().mockResolvedValue(undefined) } as any;
  return { h: new OfferAcceptedHandler(repo, listings, flags, outbox, metrics, uow, memberships, commission, audit), repo, listings, flags, outbox, tx, uow, memberships, commission, audit };
}

describe('OfferAcceptedHandler', () => {
  it('creates an order at the agreed price × qty, source=offer, offer_id set; emits link-back event', async () => {
    const { h, repo, outbox, tx } = harness();
    await h.handle(evt() as any, tx);
    expect(repo.insertGraph).toHaveBeenCalledTimes(1);
    const [, order, items] = repo.insertGraph.mock.calls[0];
    const p = order.toProps();
    expect(p.source).toBe('offer'); expect(p.offerId).toBe(offerId);
    expect(p.buyerUserId).toBe(buyer); expect(p.sellerUserId).toBe(seller);
    expect(p.status).toBe('created');                       // online_payments OFF → COD-style
    expect(items[0].props.unitPriceMinor).toBe(90000n);
    expect(items[0].props.quantity).toBe(10);
    expect(p.subtotalMinor).toBe(900000n);                  // 90000 × 10
    const types = outbox.write.mock.calls.map((c: any[]) => c[1].eventType);
    expect(types).toContain(OrderEventType.Created);
    expect(types).toContain(OrderEventType.FromOfferCreated);
    const link = outbox.write.mock.calls.find((c: any[]) => c[1].eventType === OrderEventType.FromOfferCreated)![1];
    expect(link.payload).toMatchObject({ offerId, orderId: p.id });
  });

  it('online_payments ON → order starts payment_pending', async () => {
    const { h, repo, tx } = harness({ paymentOn: true });
    await h.handle(evt() as any, tx);
    expect(repo.insertGraph.mock.calls[0][1].toProps().status).toBe('payment_pending');
  });

  it('is idempotent — an existing order for the offer means no second order', async () => {
    const { h, repo, tx } = harness({ exists: true });
    await h.handle(evt() as any, tx);
    expect(repo.insertGraph).not.toHaveBeenCalled();
  });

  it('ignores a malformed payload and a vanished listing (no order, no throw)', async () => {
    const a = harness();
    await a.h.handle(evt({ buyerUserId: undefined }) as any, a.tx);
    expect(a.repo.insertGraph).not.toHaveBeenCalled();
    const b = harness({ listing: null });
    await b.h.handle(evt() as any, b.tx);
    expect(b.repo.insertGraph).not.toHaveBeenCalled();
  });

  it('refuses a self-deal (buyer === seller) defensively', async () => {
    const { h, repo, tx } = harness({ listing: { ...listing, sellerUserId: buyer } });
    await h.handle(evt() as any, tx);
    expect(repo.insertGraph).not.toHaveBeenCalled();
  });
});

describe('PC-56 STORE-3b · the offer order carries checkout\'s fees and the accept\'s reservation (founder D2)', () => {
  it('runs in kv_app\'s unit of work for the event tenant (never the relay transaction)', async () => {
    const { h, uow, repo, tx } = harness();
    const relayTx = { query: jest.fn() } as any;
    await h.handle(evt() as any, relayTx);
    expect(uow.run).toHaveBeenCalledWith(tenantId, expect.any(Function), { userId: 'system' });
    expect(repo.insertGraph.mock.calls[0][0]).toBe(tx);
    expect(relayTx.query).not.toHaveBeenCalled();
  });
  it('the frozen commission (source offer, goods = quantity × agreed price) and a buyer-charged commission on the total; no delivery line', async () => {
    const { h, repo, commission, tx } = harness({ flagsOn: ['commission_split'], buyerCommission: 18_000n });
    await h.handle(evt() as any, tx);
    expect(commission.freezeAtPlacement).toHaveBeenCalledWith(tx, expect.objectContaining({ tenantId, source: 'offer', goodsMinor: 900000n, splitOn: true }));
    const p = repo.insertGraph.mock.calls[0][1].toProps();
    expect([p.deliveryFeeMinor, p.platformFeeMinor, p.buyerCommissionMinor, p.totalMinor]).toEqual([0n, 0n, 18_000n, 918_000n]);
    expect(p.commissionSnapshot).toEqual({ ruleId: 'r1' });
    expect((p.commissionRuleSnapshot as any).charges[0].code).toBe('buyer_commission');
  });
  it('the member-benefit platform-fee override applies exactly as at checkout (buyer charges + memberships ON)', async () => {
    const { h, repo, tx } = harness({ flagsOn: ['buyer_charges', 'memberships'], benefit: { freeDelivery: true, platformFeeBpsOverride: 100 } });
    await h.handle(evt() as any, tx);
    expect(repo.insertGraph.mock.calls[0][1].toProps().platformFeeMinor).toBe(9000n);   // 1% of 900000, floored
  });
  it('without buyer charges the override does not apply (checkout\'s rule): platform fee 0', async () => {
    const { h, repo, memberships, tx } = harness({ flagsOn: ['memberships'], benefit: { freeDelivery: true, platformFeeBpsOverride: 100 } });
    await h.handle(evt() as any, tx);
    expect(memberships.checkoutBenefits).not.toHaveBeenCalled();
    expect(repo.insertGraph.mock.calls[0][1].toProps().platformFeeMinor).toBe(0n);
  });
  it('`stockReserved: true` in the event → the order carries stock_reserved_at; absent (an event from before 3b) → NULL', async () => {
    const a = harness(); await a.h.handle(evt({ stockReserved: true }) as any, a.tx);
    expect(a.repo.insertGraph.mock.calls[0][1].toProps().stockReservedAt).toBeInstanceOf(Date);
    const b = harness(); await b.h.handle(evt() as any, b.tx);
    expect(b.repo.insertGraph.mock.calls[0][1].toProps().stockReservedAt).toBeNull();
  });
  it('a decimal quantity stays exact (12.345 × 90000 = 1111050, the order line\'s floor)', async () => {
    const { h, repo, tx } = harness();
    await h.handle(evt({ quantity: '12.345' }) as any, tx);
    const [, order, items] = repo.insertGraph.mock.calls[0];
    expect(items[0].props.quantity).toBe(12.345);
    expect(order.toProps().subtotalMinor).toBe(1_111_050n);
  });
  it('the listing vanished after a reserving accept → the quantity is released once and offer.conversion_failed audited; no order', async () => {
    const { h, repo, listings, audit, tx } = harness({ listing: null });
    await h.handle(evt({ stockReserved: true }) as any, tx);
    expect(repo.insertGraph).not.toHaveBeenCalled();
    expect(listings.releaseInTx).toHaveBeenCalledWith(tx, tenantId, listingId, '10.000');
    expect(audit.write).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'offer.conversion_failed', entityId: offerId }));
  });
  it('a re-delivery after the order exists releases nothing', async () => {
    const { h, listings, tx } = harness({ exists: true, listing: null });
    await h.handle(evt({ stockReserved: true }) as any, tx);
    expect(listings.releaseInTx).not.toHaveBeenCalled();
  });
});
