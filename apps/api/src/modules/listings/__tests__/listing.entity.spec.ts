// modules/listings/__tests__/listing.entity.spec.ts
// Pure unit tests for the aggregate's business invariants. No DB, no framework.
import { Listing } from '../domain/listing.entity';
import { InsufficientStockError, InvalidPriceError, ListingNotEditableError, InvalidRepostDurationError, InvalidExtendDurationError } from '../domain/listing.errors';
import { IllegalListingTransitionError } from '../domain/listing.errors';

const baseCreate = {
  id: 'L1', tenantId: 't1', sellerUserId: 'u1', productId: 'p1', categoryId: 'c1',
  title: 'Wheat 50 quintal', description: null,
  quantityTotal: 50, minOrderQty: 1, unitCode: 'quintal',
  priceMinor: 1_440_000n, currencyCode: 'INR',
  organicClaim: 'none' as const, saleType: 'direct' as const,
  pincode: '362001', regionId: 'r1', lat: null, lng: null,
  visibility: 'public' as const, aiExtracted: false, publishAt: null, publishedAt: null, expiresAt: null,
};

describe('Listing aggregate', () => {
  it('create() defaults quantityAvailable to total, status draft, emits created event', () => {
    const l = Listing.create({ ...baseCreate });
    expect(l.quantityAvailable).toBe(50);
    expect(l.status).toBe('draft');
    expect(l.pullEvents().map((e) => e.type)).toContain('listing.created');
  });

  it('rejects non-positive price and quantity', () => {
    expect(() => Listing.create({ ...baseCreate, priceMinor: 0n })).toThrow(InvalidPriceError);
    expect(() => Listing.create({ ...baseCreate, quantityTotal: 0 })).toThrow(InvalidPriceError);
  });

  it('publish() moves draft→published, stamps publishedAt, emits published event', () => {
    const l = Listing.create({ ...baseCreate });
    l.pullEvents();
    l.publish(new Date('2026-01-01T00:00:00Z'));
    expect(l.status).toBe('published');
    expect(l.toProps().publishedAt).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(l.pullEvents().map((e) => e.type)).toContain('listing.published');
  });

  it('reduceStock() prevents oversell and auto-sells-out at zero', () => {
    const l = Listing.create({ ...baseCreate, quantityTotal: 10 });
    l.publish(); l.pullEvents();
    expect(() => l.reduceStock(11)).toThrow(InsufficientStockError);
    l.reduceStock(10);
    expect(l.quantityAvailable).toBe(0);
    expect(l.status).toBe('sold_out');
    expect(l.pullEvents().map((e) => e.type)).toContain('listing.sold_out');
  });

  it('restock() re-publishes a sold-out listing and never exceeds total', () => {
    const l = Listing.create({ ...baseCreate, quantityTotal: 5 });
    l.publish(); l.reduceStock(5); l.pullEvents();
    l.restock(99);
    expect(l.quantityAvailable).toBe(5);
    expect(l.status).toBe('published');
  });

  it('changePrice() is a no-op (no event) when price is unchanged', () => {
    const l = Listing.create({ ...baseCreate }); l.publish(); l.pullEvents();
    l.changePrice(1_440_000n);
    expect(l.pullEvents()).toHaveLength(0);
  });

  it('changePrice() forbidden in non-editable state', () => {
    const l = Listing.create({ ...baseCreate }); l.publish(); l.reduceStock(50); // sold_out
    expect(() => l.changePrice(999n)).toThrow(ListingNotEditableError);
  });

  it('repost() brings an EXPIRED listing back to published with a fresh expiry window', () => {
    const l = Listing.create({ ...baseCreate }); l.publish(); l.expire(); l.pullEvents();
    const now = new Date('2026-06-30T00:00:00Z');
    l.repost(7, now);
    expect(l.status).toBe('published');
    const p = l.toProps();
    expect(p.publishedAt).toEqual(now);
    expect(p.expiresAt).toEqual(new Date('2026-07-07T00:00:00Z')); // +7 days, not the stale past expiry
    expect(l.pullEvents().map((e) => e.type)).toContain('listing.published');
  });

  it('repost() can update the price atomically and emits price_changed', () => {
    const l = Listing.create({ ...baseCreate }); l.publish(); l.expire(); l.pullEvents();
    l.repost(7, new Date('2026-06-30T00:00:00Z'), 1_460_000n);
    expect(l.toProps().priceMinor).toBe(1_460_000n);
    expect(l.pullEvents().map((e) => e.type)).toContain('listing.price_changed');
  });

  it('repost() rejects an invalid duration and a non-positive price', () => {
    const mk = () => { const l = Listing.create({ ...baseCreate }); l.publish(); l.expire(); return l; };
    expect(() => mk().repost(0)).toThrow(InvalidRepostDurationError);
    expect(() => mk().repost(61)).toThrow(InvalidRepostDurationError);
    expect(() => mk().repost(7, new Date(), 0n)).toThrow(InvalidPriceError);
  });

  it('repost() refuses an illegal source state (e.g. a live published listing)', () => {
    const l = Listing.create({ ...baseCreate }); l.publish(); // published → published is illegal
    expect(() => l.repost(7)).toThrow(IllegalListingTransitionError);
  });

  describe('extend() — KV-BL-031 (screen 112 EXTEND cta)', () => {
    it('pushes expiresAt out by `days` from the CURRENT expiry when it is still in the future', () => {
      const l = Listing.create({ ...baseCreate });
      l.publish(new Date('2026-01-01T00:00:00Z'));
      // simulate an existing future expiry via repost's side-effect-free path: reconstruct with an expiresAt
      const withExpiry = Listing.rehydrate({ ...l.toProps(), expiresAt: new Date('2026-01-10T00:00:00Z') });
      withExpiry.pullEvents();
      withExpiry.extend(5, new Date('2026-01-05T00:00:00Z'));
      expect(withExpiry.toProps().expiresAt).toEqual(new Date('2026-01-15T00:00:00Z')); // +5 days from the OLD expiry, not from now
    });

    it('extends from `now` when expiresAt is null (a published listing with no expiry set yet)', () => {
      const l = Listing.create({ ...baseCreate });
      l.publish(new Date('2026-01-01T00:00:00Z'));
      l.pullEvents();
      l.extend(3, new Date('2026-01-01T00:00:00Z'));
      expect(l.toProps().expiresAt).toEqual(new Date('2026-01-04T00:00:00Z'));
    });

    it('extends from `now` (not the stale past expiry) when the current expiresAt has already lapsed', () => {
      const l = Listing.create({ ...baseCreate });
      l.publish();
      const withExpiry = Listing.rehydrate({ ...l.toProps(), expiresAt: new Date('2025-01-01T00:00:00Z') });
      withExpiry.pullEvents();
      withExpiry.extend(2, new Date('2026-01-01T00:00:00Z'));
      expect(withExpiry.toProps().expiresAt).toEqual(new Date('2026-01-03T00:00:00Z'));
    });

    it('does NOT touch quantityAvailable/status — only expiresAt moves', () => {
      const l = Listing.create({ ...baseCreate, quantityTotal: 10 });
      l.publish(); l.pullEvents();
      l.extend(4);
      expect(l.quantityAvailable).toBe(10);
      expect(l.status).toBe('published');
    });

    it('emits listing.extended (and nothing else)', () => {
      const l = Listing.create({ ...baseCreate });
      l.publish(); l.pullEvents();
      l.extend(10, new Date('2026-01-01T00:00:00Z'));
      const events = l.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('listing.extended');
    });

    it('rejects an out-of-bounds or non-integer duration (domain re-validates the zod 1..30 bound)', () => {
      const mk = () => { const l = Listing.create({ ...baseCreate }); l.publish(); return l; };
      expect(() => mk().extend(0)).toThrow(InvalidExtendDurationError);
      expect(() => mk().extend(31)).toThrow(InvalidExtendDurationError);
      expect(() => mk().extend(1.5)).toThrow(InvalidExtendDurationError);
    });

    it('refuses to extend a non-published listing (e.g. draft or expired)', () => {
      const draft = Listing.create({ ...baseCreate });
      expect(() => draft.extend(5)).toThrow(ListingNotEditableError);
      const expired = Listing.create({ ...baseCreate }); expired.publish(); expired.expire();
      expect(() => expired.extend(5)).toThrow(ListingNotEditableError);
    });
  });

  describe('archive() — KV-MF-08 (screen 112 Remove cta)', () => {
    it('moves a published listing to archived and emits status_changed', () => {
      const l = Listing.create({ ...baseCreate }); l.publish(); l.pullEvents();
      l.archive();
      expect(l.status).toBe('archived');
      const events = l.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'listing.status_changed', from: 'published', to: 'archived' });
    });

    it('is reachable from every non-terminal status (draft, paused, sold_out, expired, hidden, rejected)', () => {
      const draft = Listing.create({ ...baseCreate });
      expect(() => draft.archive()).not.toThrow();

      const paused = Listing.create({ ...baseCreate }); paused.publish(); paused.pause();
      expect(() => paused.archive()).not.toThrow();

      const soldOut = Listing.create({ ...baseCreate, quantityTotal: 1 }); soldOut.publish(); soldOut.reduceStock(1);
      expect(() => soldOut.archive()).not.toThrow();

      const expired = Listing.create({ ...baseCreate }); expired.publish(); expired.expire();
      expect(() => expired.archive()).not.toThrow();

      const hidden = Listing.create({ ...baseCreate }); hidden.publish(); hidden.hide();
      expect(() => hidden.archive()).not.toThrow();
    });

    it('is TERMINAL — an already-archived listing refuses a second archive() (never a silent no-op)', () => {
      const l = Listing.create({ ...baseCreate }); l.archive();
      expect(() => l.archive()).toThrow(IllegalListingTransitionError);
    });

    it('refuses from pending_approval (not yet a legal source status — surfaces the real 409, not a fake success)', () => {
      const l = Listing.create({ ...baseCreate }); l.submitForApproval();
      expect(() => l.archive()).toThrow(IllegalListingTransitionError);
    });
  });
});
