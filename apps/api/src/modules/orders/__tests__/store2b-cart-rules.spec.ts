// modules/orders/__tests__/store2b-cart-rules.spec.ts · PC-56 STORE-2b · C8 (API unit) — THE CART'S ONE RULE, pure: decimal quantities as
// strings (never a float), the minimum order with the minimum and unit named, both prices and the signed delta, every reason a line cannot be
// bought by name; the kill-switch's gate (named 503, fail OPEN); the cart-item service's refusals (licence, wrong store, minimum, reason) and
// the accept-price act (idempotent, refuses an unseen price) over hand mocks.
import { assertMinOrder, compareQty, isBelowMin, lineReason, lineTotalFromMilli, LINE_REASONS, milliToDecimal, normaliseQty, priceDrift, toMilli } from '../domain/cart-rules';
import { lineTotalMinor } from '../domain/orders.events';
import { OrderItem } from '../domain/order-item.entity';
import { BelowMinOrderError } from '../domain/orders.errors';
import { StorefrontCartGate, StorefrontCartGuard, StorefrontCartOffError, STOREFRONT_CART_FLAG } from '../storefront-cart.guard';
import { CartItemService } from '../services/cart-item.service';
import { AddToCartSchema, AcceptPriceSchema } from '../dto/create-cart-item.dto';

type Refusal = { code?: string; details?: any };   // eslint-disable-line @typescript-eslint/no-explicit-any -- a refusal's details, asserted by shape
const code = async (p: Promise<unknown>): Promise<Refusal | 'OK'> => p.then(() => 'OK' as const, (e: Refusal) => ({ code: e.code, details: e.details }));

describe('STORE-2b · quantities are decimal strings (F-24)', () => {
  it('toMilli / normaliseQty: "2.5" = 2.5 = "2.500" → 2500 → "2.500"; integers; 3 places', () => {
    expect([toMilli('2.5'), toMilli(2.5), toMilli('2.500'), toMilli('7'), toMilli('0.001')]).toEqual([2500n, 2500n, 2500n, 7000n, 1n]);
    expect([normaliseQty('2.5'), normaliseQty(2.5), normaliseQty('34'), normaliseQty('0.125')]).toEqual(['2.500', '2.500', '34.000', '0.125']);
    expect(milliToDecimal(1234567n)).toBe('1234.567');
  });
  it('never a float: a string is read digit by digit; a float input is written as a decimal first (0.1 + 0.2 → 0.300)', () => {
    expect(toMilli('1.005')).toBe(1005n);
    expect(toMilli('999999.999')).toBe(999999999n);
    expect(toMilli(0.1 + 0.2)).toBe(300n);
    expect(compareQty('2.5', '2.500')).toBe(0);
    expect(compareQty('2.499', 2.5)).toBe(-1);
  });
  it('refuses what is not a non-negative decimal (ORDER_INVALID_QUANTITY); zero is not a quantity', () => {
    for (const bad of ['', 'abc', '-1', '1e3', '2,5', ' . ']) expect(() => toMilli(bad)).toThrow(/Quantity/);
    expect(() => normaliseQty('0')).toThrow(/Quantity/);
    expect(() => toMilli(Number.NaN)).toThrow(/Quantity/);
  });
  it('the line total is bigint over thousandths, floored — the two former float sites agree', () => {
    expect(lineTotalMinor(615000n, '2.5')).toBe(1537500n);
    expect(lineTotalMinor(615000n, 2.5)).toBe(1537500n);
    expect(lineTotalFromMilli(33333n, 333n)).toBe(11099n);     // 33333 × 0.333 = 11099.889 → floored
    expect(OrderItem.of({ id: 'i', orderId: 'o', orderCreatedAt: new Date(), tenantId: 't', listingId: 'l', productId: 'p', titleSnapshot: 'x',
      quantity: 2.5, unitCode: 'quintal', unitPriceMinor: 615000n, gstRatePct: null, hsnCode: null, batchId: null }).props.lineTotalMinor).toBe(1537500n);
  });
  it('the DTO takes a decimal string or a number, never more than 3 places / a sign / zero', () => {
    const L = '0208a000-0000-7000-8000-000000000001';
    expect(AddToCartSchema.safeParse({ listingId: L, quantity: '2.5' }).success).toBe(true);
    expect(AddToCartSchema.safeParse({ listingId: L, quantity: 3 }).success).toBe(true);
    for (const q of ['2.5001', '-1', '0', '1e3', 2.0001, 0]) expect([q, AddToCartSchema.safeParse({ listingId: L, quantity: q }).success]).toEqual([q, false]);
    expect(AcceptPriceSchema.safeParse({ expectedPriceMinor: '256000' }).success).toBe(true);
    expect(AcceptPriceSchema.safeParse({ expectedPriceMinor: '2.5' }).success).toBe(false);
  });
});

describe('STORE-2b · the minimum order (D4)', () => {
  it('below the minimum → BELOW_MIN_ORDER naming the minimum and the unit (decimal strings); at or above → passes; 0 = no minimum', () => {
    let err: BelowMinOrderError | null = null;
    try { assertMinOrder('L1', '3', 5, 'quintal'); } catch (e) { err = e as BelowMinOrderError; }
    expect([err?.code, err?.httpStatus, err?.details]).toEqual(['BELOW_MIN_ORDER', 422, { listingId: 'L1', minOrderQty: '5.000', unitCode: 'quintal', requested: '3.000' }]);
    expect(() => assertMinOrder('L1', '5', 5, 'quintal')).not.toThrow();
    expect(() => assertMinOrder('L1', '4.999', '5.000', 'quintal')).toThrow(BelowMinOrderError);
    expect(() => assertMinOrder('L1', '0.5', 0, 'quintal')).not.toThrow();
    expect([isBelowMin('2.5', 5), isBelowMin('5', 5), isBelowMin('1', null)]).toEqual([true, false, false]);
  });
});

describe('STORE-2b · both prices and the delta (D4)', () => {
  it('priceDrift names added, current and the signed delta as minor strings', () => {
    expect(priceDrift(252000n, 256000n)).toEqual({ changed: true, addedPriceMinor: '252000', currentPriceMinor: '256000', deltaMinor: '4000' });
    expect(priceDrift('256000', 252000)).toEqual({ changed: true, addedPriceMinor: '256000', currentPriceMinor: '252000', deltaMinor: '-4000' });
    expect(priceDrift(615000n, '615000').changed).toBe(false);
  });
});

describe('STORE-2b · why a line cannot be bought, by name', () => {
  const base = { status: 'published', visibility: 'public', quantityAvailable: 34, sellerSuspended: false, licenceRequired: false };
  it('each reason', () => {
    expect(lineReason(base)).toBeNull();
    expect(lineReason({ ...base, status: null })).toBe('not_found');
    expect(lineReason({ ...base, visibility: 'tenant' })).toBe('not_found');
    expect(lineReason({ ...base, sellerSuspended: true })).toBe('suspended');
    expect(lineReason({ ...base, status: 'sold_out' })).toBe('sold_out');
    expect(lineReason({ ...base, quantityAvailable: '0.000' })).toBe('sold_out');
    expect(lineReason({ ...base, status: 'paused' })).toBe('paused');
    expect(lineReason({ ...base, status: 'expired' })).toBe('expired');
    expect(lineReason({ ...base, status: 'archived' })).toBe('withdrawn');
    for (const s of ['draft', 'pending_approval', 'rejected', 'held', 'reserved_auction']) expect(lineReason({ ...base, status: s })).toBe('not_found');
    expect(lineReason({ ...base, licenceRequired: true })).toBe('licence_required');
    expect([...LINE_REASONS]).toEqual(['sold_out', 'paused', 'expired', 'withdrawn', 'suspended', 'licence_required', 'not_found']);
  });
  it('a suspended seller is said before the status (the standing a buyer can act on)', () => {
    expect(lineReason({ ...base, status: 'paused', sellerSuspended: true })).toBe('suspended');
  });
});

describe('STORE-2b · the kill-switch (D2): named 503, fail OPEN, platform-scoped', () => {
  it('OFF → STOREFRONT_CART_OFF 503; ON → open; a flag-store failure → open (the reason is in the header); evaluated with {}', async () => {
    const isEnabled = jest.fn(async () => false);
    const gate = new StorefrontCartGate({ isEnabled } as never);
    await expect(new StorefrontCartGuard(gate).canActivate()).rejects.toBeInstanceOf(StorefrontCartOffError);
    expect(isEnabled).toHaveBeenCalledWith(STOREFRONT_CART_FLAG, {});
    expect(new StorefrontCartOffError().httpStatus).toBe(503);
    expect(await new StorefrontCartGate({ isEnabled: async () => true } as never).isOpen()).toBe(true);
    expect(await new StorefrontCartGate({ isEnabled: async () => { throw new Error('down'); } } as never).isOpen()).toBe(true);
  });
});

describe('STORE-2b · the cart-item service (hand mocks)', () => {
  const T = 'tenant-a'; const B = 'tenant-b'; const L = 'listing-1';
  const listing = (over: Record<string, unknown> = {}) => ({ id: L, tenantId: T, status: 'published', visibility: 'public', quantityAvailable: 34,
    minOrderQty: 5, unitCode: 'quintal', priceMinor: 256000n, currencyCode: 'INR', ...over });
  function world(o: { here?: unknown; there?: unknown; facts?: Record<string, unknown> | null; line?: { added_price_minor: string } | null } = {}) {
    const writes: string[] = [];
    const tx = {};
    const listings = {
      getById: jest.fn(async (t: string) => (t === T ? ('here' in o ? o.here : listing()) : ('there' in o ? o.there : null))),
      purchaseFacts: jest.fn(async (t: string, ids: string[]) => (o.facts === null ? null : new Map(ids.map((id) => [id, {
        listingId: id, visibility: 'public', sellerSuspended: false, licenceRequired: false, bannedRegion: null,
        organisation: { slug: t === B ? 'girnar-fpo' : 'anand-fpo', name: t === B ? 'Girnar FPO' : 'Anand FPO' }, district: 'Junagadh', ...(o.facts ?? {}) }])))),
    };
    const uow = { run: async (_t: string, fn: (tx: unknown) => Promise<unknown>) => fn(tx) };
    const carts = { getOrCreateActiveId: async () => 'cart-1', activeIdForUpdate: async () => 'cart-1' };
    const items = {
      upsert: async (_tx: unknown, _c: string, _l: string, q: string, p: bigint) => { writes.push(`upsert ${q} @${p}`); },
      setQty: async (_tx: unknown, _c: string, _l: string, q: string) => { writes.push(`set ${q}`); return 1; },
      lineForUpdate: async () => ('line' in o ? o.line : { added_price_minor: '252000' }),
      acceptPrice: async (_tx: unknown, _c: string, _l: string, p: bigint) => { writes.push(`accept @${p}`); return '2026-10-15T00:00:00.000Z'; },
    };
    const metrics = { inc: () => undefined };
    const svc = new CartItemService(uow as never, metrics as never, listings as never, carts as never, items as never);
    return { svc, writes, listings };
  }
  it('add stores the decimal string and the price; below min / over stock / licence / suspended / sold out are refused by name', async () => {
    const w = world();
    expect(await w.svc.addItem(T, 'u', { listingId: L, quantity: '5.5' })).toEqual({ ok: true });
    expect(w.writes).toEqual(['upsert 5.500 @256000']);
    expect(await code(w.svc.addItem(T, 'u', { listingId: L, quantity: '3' }))).toEqual({ code: 'BELOW_MIN_ORDER', details: { listingId: L, minOrderQty: '5.000', unitCode: 'quintal', requested: '3.000' } });
    expect((await code(w.svc.addItem(T, 'u', { listingId: L, quantity: '34.001' })) as Refusal).code).toBe('LISTING_INSUFFICIENT_STOCK');
    expect((await code(world({ facts: { licenceRequired: true } }).svc.addItem(T, 'u', { listingId: L, quantity: '5' })) as Refusal).code).toBe('LICENCE_REQUIRED');
    expect(await code(world({ facts: { sellerSuspended: true } }).svc.addItem(T, 'u', { listingId: L, quantity: '5' }))).toEqual({ code: 'LISTING_NOT_PURCHASABLE', details: { listingId: L, reason: 'suspended' } });
    expect(await code(world({ here: listing({ status: 'sold_out' }) }).svc.addItem(T, 'u', { listingId: L, quantity: '5' }))).toEqual({ code: 'LISTING_NOT_PURCHASABLE', details: { listingId: L, reason: 'sold_out' } });
    expect(await code(world().svc.updateItem(T, 'u', L, '4.999'))).toMatchObject({ code: 'BELOW_MIN_ORDER' });
  });
  it('D3 · another store\'s listing with the request\'s store named → WRONG_STORE with THAT store\'s slug; no store header → not_found', async () => {
    const w = world({ here: null, there: listing({ tenantId: B }) });
    expect(await code(w.svc.addItem(T, 'u', { listingId: L, quantity: '5' }, B))).toEqual({ code: 'WRONG_STORE', details: { listingId: L, listingTenantSlug: 'girnar-fpo', listingTenantName: 'Girnar FPO' } });
    expect(await code(w.svc.addItem(T, 'u', { listingId: L, quantity: '5' }))).toEqual({ code: 'LISTING_NOT_PURCHASABLE', details: { listingId: L, reason: 'not_found' } });
    // the other store's lot is not on sale (a draft) → never named, just not_found
    expect((await code(world({ here: null, there: listing({ status: 'draft' }) }).svc.addItem(T, 'u', { listingId: L, quantity: '5' }, B)) as Refusal).details.reason).toBe('not_found');
  });
  it('B12 · accept-price re-snapshots to the CURRENT price; an unchanged price is a no-op; an unseen price is refused with the newest numbers', async () => {
    const w = world();
    expect(await w.svc.acceptPrice(T, 'u', L, '256000')).toMatchObject({ changed: true, previousPriceMinor: '252000', acceptedPriceMinor: '256000', currencyCode: 'INR' });
    expect(w.writes).toEqual(['accept @256000']);
    const same = world({ line: { added_price_minor: '256000' } });
    expect(await same.svc.acceptPrice(T, 'u', L, '256000')).toMatchObject({ changed: false, acceptedAt: null });
    expect(same.writes).toEqual([]);
    expect(await code(world().svc.acceptPrice(T, 'u', L, '254000'))).toEqual({ code: 'PRICE_CHANGED', details: { listingId: L, addedPriceMinor: '252000', currentPriceMinor: '256000', currencyCode: 'INR' } });
    expect(await code(world({ here: listing({ status: 'paused' }) }).svc.acceptPrice(T, 'u', L, '256000'))).toEqual({ code: 'LISTING_NOT_PURCHASABLE', details: { listingId: L, reason: 'paused' } });
  });
});
