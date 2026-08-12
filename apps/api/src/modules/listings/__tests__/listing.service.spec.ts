// modules/listings/__tests__/listing.service.spec.ts
// Unit tests for the application service orchestration: idempotency wrapping,
// quota enforcement, single-transaction persistence, outbox-in-tx event flushing,
// and ENFORCED ownership/authorization. All infra is mocked — proves the WIRING.
import { ListingService } from '../services/listing.service';
import { ForbiddenError } from '../../../shared/errors/app-error';
import { PhotoMediaInvalidError, TooManyPhotosError } from '../domain/listing.errors';

function makeTx() {
  return { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }), tenantId: 't1', userId: 'u1' };
}

const dto: any = {
  productId: '11111111-1111-1111-1111-111111111111', categoryId: '22222222-2222-2222-2222-222222222222',
  title: 'Organic Wheat', quantityTotal: 50, minOrderQty: 1, unitCode: 'quintal',
  priceMinor: '1440000', currencyCode: 'INR', organicClaim: 'certified', saleType: 'direct',
  visibility: 'public', attributes: [], mediaIds: ['33333333-3333-3333-3333-333333333333'],
};

function build() {
  const tx = makeTx();
  const uow: any = { run: jest.fn((_t: string, fn: any) => fn(tx)) };
  const outbox: any = { write: jest.fn().mockResolvedValue(undefined) };
  const quota: any = { assertWithinLimit: jest.fn().mockResolvedValue(undefined), increment: jest.fn().mockResolvedValue(undefined) };
  const idem: any = { remember: jest.fn((_k: string, _u: string, _o: string, fn: any) => fn()) };
  const cache: any = { del: jest.fn(), wrap: jest.fn((_k: string, _t: number, load: any) => load()), get: jest.fn(), set: jest.fn() };
  const metrics: any = { inc: jest.fn(), observe: jest.fn() };
  const repo: any = { insert: jest.fn().mockResolvedValue(undefined), update: jest.fn().mockResolvedValue(undefined),
    getForUpdate: jest.fn(), findById: jest.fn() };
  const priceHist: any = { append: jest.fn() };
  const attrs: any = { upsertMany: jest.fn().mockResolvedValue(undefined) };
  const media: any = {
    attach: jest.fn().mockResolvedValue(undefined),
    photoAttachable: jest.fn().mockResolvedValue(true),
    countForListing: jest.fn().mockResolvedValue(0),
    attachOne: jest.fn().mockResolvedValue(undefined),
  };
  const audit: any = { write: jest.fn().mockResolvedValue(undefined) };
  const svc = new ListingService(uow, outbox, quota, idem, cache, metrics, repo, priceHist, attrs, media, audit);
  return { svc, uow, outbox, quota, idem, cache, metrics, repo, priceHist, attrs, media, audit, tx };
}

// A fake persisted listing for read-path tests (getById → repo.findById → toProps()).
const fakeListing = (over: Record<string, unknown> = {}) => ({
  toProps: () => ({ id: 'L1', status: 'draft', visibility: 'tenant', sellerUserId: 'owner-A', ...over }),
});

describe('ListingService.create', () => {
  it('enforces quota before creating', async () => {
    const { svc, quota } = build();
    await svc.create('t1', 'u1', 'idem-1', dto);
    expect(quota.assertWithinLimit).toHaveBeenCalledWith('t1', 'max_listings_month');
  });

  it('persists the listing, attaches media, and flushes created event to outbox in the same tx', async () => {
    const { svc, repo, quota, outbox, media } = build();
    await svc.create('t1', 'u1', 'idem-1', dto);
    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(quota.increment).toHaveBeenCalledTimes(1);
    expect(media.attach).toHaveBeenCalledWith(expect.anything(), 't1', expect.any(String), dto.mediaIds);
    const eventTypes = outbox.write.mock.calls.map((c: any[]) => c[1].eventType);
    expect(eventTypes).toContain('listing.created');
  });

  it('wraps the whole use-case in idempotency.remember', async () => {
    const { svc, idem } = build();
    await svc.create('t1', 'u1', 'idem-key-xyz', dto);
    expect(idem.remember).toHaveBeenCalledWith('idem-key-xyz', 'u1', 'listings.create', expect.any(Function));
  });

  it('returns a generated id', async () => {
    const { svc } = build();
    const { id } = await svc.create('t1', 'u1', 'idem-1', dto);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
});

describe('ListingService authorization (security regression guard)', () => {
  const otherOwnersListing = {
    sellerUserId: 'owner-A', id: 'L9', version: 1,
    publish: jest.fn(), changePrice: jest.fn(),
    pullEvents: () => [], price: { minor: 100n },
  };

  it('publish() by a non-owner WITHOUT moderate permission throws ForbiddenError', async () => {
    const { svc, repo } = build();
    repo.getForUpdate.mockResolvedValue(otherOwnersListing);
    await expect(svc.publish('t1', { userId: 'intruder-B', canModerate: false }, 'L9'))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect(otherOwnersListing.publish).not.toHaveBeenCalled();
  });

  it('publish() by an admin WITH moderate permission is allowed and is audited (override)', async () => {
    const { svc, repo, audit } = build();
    repo.getForUpdate.mockResolvedValue({ ...otherOwnersListing, publish: jest.fn(), pullEvents: () => [] });
    await expect(svc.publish('t1', { userId: 'admin-Z', canModerate: true }, 'L9')).resolves.toBeUndefined();
    expect(audit.write).toHaveBeenCalled(); // moderator acting on another's listing leaves a trail
  });
});

describe('ListingService.extend — KV-BL-031 (screen 112 EXTEND cta)', () => {
  const published = { sellerUserId: 'owner-A', id: 'L1', version: 1, status: 'published', priceMinor: 100n };
  function listingStub(overrides: Record<string, unknown> = {}) {
    const props = { ...published, expiresAt: null, ...overrides };
    return {
      sellerUserId: props.sellerUserId,
      extend: jest.fn(function (this: any, days: number) { this._extended = days; }),
      toProps: () => ({ ...props, expiresAt: props.expiresAt ?? new Date('2026-02-01T00:00:00Z') }),
      pullEvents: () => [{ type: 'listing.extended', listingId: 'L1', expiresAt: '2026-02-01T00:00:00.000Z', days: 5 }],
    };
  }

  it('wraps the call in idempotency.remember keyed by (idemKey, userId, "listings.extend")', async () => {
    const { svc, repo, idem } = build();
    repo.getForUpdate.mockResolvedValue(listingStub());
    await svc.extend('t1', { userId: 'owner-A', canModerate: false }, 'idem-ext-1', 'L1', 5);
    expect(idem.remember).toHaveBeenCalledWith('idem-ext-1', 'owner-A', 'listings.extend', expect.any(Function));
  });

  it('a retry with the SAME Idempotency-Key does not call the entity/repo twice (idem.remember short-circuits)', async () => {
    const { svc, repo, idem } = build();
    let calls = 0;
    idem.remember.mockImplementation(async (_k: string, _u: string, _o: string, fn: any) => {
      calls += 1;
      return calls === 1 ? fn() : { id: 'L1', expiresAt: 'cached' }; // 2nd call: idem service returns the CACHED result, fn never re-invoked
    });
    repo.getForUpdate.mockResolvedValue(listingStub());
    const first = await svc.extend('t1', { userId: 'owner-A', canModerate: false }, 'idem-ext-2', 'L1', 5);
    const second = await svc.extend('t1', { userId: 'owner-A', canModerate: false }, 'idem-ext-2', 'L1', 5);
    expect(repo.update).toHaveBeenCalledTimes(1); // the entity/repo only ran on the FIRST attempt
    expect(second).toEqual({ id: 'L1', expiresAt: 'cached' });
    expect(first).not.toEqual(second);
  });

  it('persists via repo.update and flushes listing.extended to the outbox in the same tx', async () => {
    const { svc, repo, outbox } = build();
    repo.getForUpdate.mockResolvedValue(listingStub());
    await svc.extend('t1', { userId: 'owner-A', canModerate: false }, 'idem-ext-3', 'L1', 5);
    expect(repo.update).toHaveBeenCalledTimes(1);
    const eventTypes = outbox.write.mock.calls.map((c: any[]) => c[1].eventType);
    expect(eventTypes).toContain('listing.extended');
  });

  it('returns { id, expiresAt } from the post-extend listing state', async () => {
    const { svc, repo } = build();
    repo.getForUpdate.mockResolvedValue(listingStub({ expiresAt: new Date('2026-03-01T00:00:00Z') }));
    const res = await svc.extend('t1', { userId: 'owner-A', canModerate: false }, 'idem-ext-4', 'L1', 5);
    expect(res).toEqual({ id: 'L1', expiresAt: '2026-03-01T00:00:00.000Z' });
  });

  it('a non-owner WITHOUT moderate permission is rejected with ForbiddenError (owner-only)', async () => {
    const { svc, repo } = build();
    repo.getForUpdate.mockResolvedValue(listingStub());
    await expect(svc.extend('t1', { userId: 'intruder-B', canModerate: false }, 'idem-ext-5', 'L1', 5))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it('a moderator MAY extend a listing they do not own, and it is audited', async () => {
    const { svc, repo, audit } = build();
    repo.getForUpdate.mockResolvedValue(listingStub());
    await svc.extend('t1', { userId: 'admin-Z', canModerate: true }, 'idem-ext-6', 'L1', 5);
    expect(audit.write).toHaveBeenCalled();
  });
});

describe('ListingService.archive — KV-MF-08 (screen 112 Remove cta)', () => {
  function archivableStub(overrides: Record<string, unknown> = {}) {
    const props = { sellerUserId: 'owner-A', id: 'L1', version: 1, status: 'published', ...overrides };
    return {
      sellerUserId: props.sellerUserId,
      get status() { return props.status; },
      archive: jest.fn(function (this: any) { props.status = 'archived'; }),
      toProps: () => ({ ...props }),
      pullEvents: () => [{ type: 'listing.status_changed', listingId: 'L1', from: 'published', to: 'archived' }],
    };
  }

  it('wraps the call in idempotency.remember keyed by (idemKey, userId, "listings.archive")', async () => {
    const { svc, repo, idem } = build();
    repo.getForUpdate.mockResolvedValue(archivableStub());
    await svc.archive('t1', { userId: 'owner-A', canModerate: false }, 'idem-arc-1', 'L1');
    expect(idem.remember).toHaveBeenCalledWith('idem-arc-1', 'owner-A', 'listings.archive', expect.any(Function));
  });

  it('a retry with the SAME Idempotency-Key does not call the entity/repo twice (never a second illegal transition)', async () => {
    const { svc, repo, idem } = build();
    let calls = 0;
    idem.remember.mockImplementation(async (_k: string, _u: string, _o: string, fn: any) => {
      calls += 1;
      return calls === 1 ? fn() : { id: 'L1', status: 'archived' }; // 2nd call: cached result, fn never re-invoked
    });
    repo.getForUpdate.mockResolvedValue(archivableStub());
    const first = await svc.archive('t1', { userId: 'owner-A', canModerate: false }, 'idem-arc-2', 'L1');
    const second = await svc.archive('t1', { userId: 'owner-A', canModerate: false }, 'idem-arc-2', 'L1');
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ id: 'L1', status: 'archived' });
    expect(first).toEqual({ id: 'L1', status: 'archived' });
  });

  it('persists via repo.update and flushes the status_changed event to the outbox in the same tx', async () => {
    const { svc, repo, outbox } = build();
    repo.getForUpdate.mockResolvedValue(archivableStub());
    await svc.archive('t1', { userId: 'owner-A', canModerate: false }, 'idem-arc-3', 'L1');
    expect(repo.update).toHaveBeenCalledTimes(1);
    const eventTypes = outbox.write.mock.calls.map((c: any[]) => c[1].eventType);
    expect(eventTypes).toContain('listing.status_changed');
  });

  it('returns { id, status: "archived" } on success', async () => {
    const { svc, repo } = build();
    repo.getForUpdate.mockResolvedValue(archivableStub());
    const res = await svc.archive('t1', { userId: 'owner-A', canModerate: false }, 'idem-arc-4', 'L1');
    expect(res).toEqual({ id: 'L1', status: 'archived' });
  });

  it('a non-owner WITHOUT moderate permission is rejected with ForbiddenError (owner-only) and never archives', async () => {
    const { svc, repo } = build();
    const stub = archivableStub();
    repo.getForUpdate.mockResolvedValue(stub);
    await expect(svc.archive('t1', { userId: 'intruder-B', canModerate: false }, 'idem-arc-5', 'L1'))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect(stub.archive).not.toHaveBeenCalled();
  });

  it('a moderator MAY archive a listing they do not own — WITH the reason the seller will read (TENANT-2b)', async () => {
    const { svc, repo, audit } = build();
    repo.getForUpdate.mockResolvedValue(archivableStub());
    await svc.archive('t1', { userId: 'admin-Z', canModerate: true }, 'idem-arc-6', 'L1', 'duplicate listing, seller notified');
    expect(audit.write).toHaveBeenCalled();
  });

  it('invalidates the listing cache on success', async () => {
    const { svc, repo, cache } = build();
    repo.getForUpdate.mockResolvedValue(archivableStub());
    await svc.archive('t1', { userId: 'owner-A', canModerate: false }, 'idem-arc-7', 'L1');
    expect(cache.del).toHaveBeenCalledWith('t:t1:listing:L1');
  });
});

describe('ListingService.addPhoto — KV-MF-14 (screen 112 "Add more photos" cta)', () => {
  const listingStub = (overrides: Record<string, unknown> = {}) => ({ sellerUserId: 'owner-A', id: 'L1', ...overrides });

  it('attaches the photo, returns the LIVE post-attach count, and flushes listing.photo_attached to the outbox', async () => {
    const { svc, repo, media, outbox } = build();
    repo.getForUpdate.mockResolvedValue(listingStub());
    media.countForListing.mockResolvedValueOnce(2).mockResolvedValueOnce(3); // cap check (2), then post-attach live count (3)
    const res = await svc.addPhoto('t1', { userId: 'owner-A', canModerate: false }, 'L1', 'media-1');
    expect(media.attachOne).toHaveBeenCalledWith(expect.anything(), 'L1', 'media-1');
    expect(res).toEqual({ photoCount: 3 });
    const eventTypes = outbox.write.mock.calls.map((c: any[]) => c[1].eventType);
    expect(eventTypes).toContain('listing.photo_attached');
  });

  it('rejects a media asset that is not a clean, owned IMAGE (PhotoMediaInvalidError) — never attaches', async () => {
    const { svc, repo, media } = build();
    repo.getForUpdate.mockResolvedValue(listingStub());
    media.photoAttachable.mockResolvedValue(false);
    await expect(svc.addPhoto('t1', { userId: 'owner-A', canModerate: false }, 'L1', 'media-1')).rejects.toBeInstanceOf(PhotoMediaInvalidError);
    expect(media.attachOne).not.toHaveBeenCalled();
  });

  it('rejects once the listing is already at the photo cap (TooManyPhotosError) — never attaches', async () => {
    const { svc, repo, media } = build();
    repo.getForUpdate.mockResolvedValue(listingStub());
    media.countForListing.mockResolvedValue(10);
    await expect(svc.addPhoto('t1', { userId: 'owner-A', canModerate: false }, 'L1', 'media-1')).rejects.toBeInstanceOf(TooManyPhotosError);
    expect(media.attachOne).not.toHaveBeenCalled();
  });

  it('a non-owner WITHOUT moderate permission is rejected with ForbiddenError (owner-only) — never attaches', async () => {
    const { svc, repo, media } = build();
    repo.getForUpdate.mockResolvedValue(listingStub());
    await expect(svc.addPhoto('t1', { userId: 'intruder-B', canModerate: false }, 'L1', 'media-1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(media.attachOne).not.toHaveBeenCalled();
  });

  it('a moderator MAY add a photo to a listing they do not own, and it is audited', async () => {
    const { svc, repo, media, audit } = build();
    repo.getForUpdate.mockResolvedValue(listingStub());
    await svc.addPhoto('t1', { userId: 'admin-Z', canModerate: true }, 'L1', 'media-1');
    expect(media.attachOne).toHaveBeenCalledTimes(1);
    expect(audit.write).toHaveBeenCalled();
  });
});

describe('ListingService.getPublicById (data-exposure regression guard)', () => {
  it('hides a DRAFT listing from an anonymous viewer (404, not the data)', async () => {
    const { svc, repo } = build();
    repo.findById.mockResolvedValue(fakeListing({ status: 'draft', visibility: 'public' }));
    await expect(svc.getPublicById('t1', 'L1', { userId: '', canModerate: false })).rejects.toBeTruthy();
  });
  it('hides a PUBLISHED-but-tenant-only listing from an anonymous viewer', async () => {
    const { svc, repo } = build();
    repo.findById.mockResolvedValue(fakeListing({ status: 'published', visibility: 'tenant' }));
    await expect(svc.getPublicById('t1', 'L1', { userId: '', canModerate: false })).rejects.toBeTruthy();
  });
  it('shows a PUBLISHED + public listing to anyone', async () => {
    const { svc, repo } = build();
    repo.findById.mockResolvedValue(fakeListing({ status: 'published', visibility: 'public' }));
    await expect(svc.getPublicById('t1', 'L1', { userId: '', canModerate: false })).resolves.toBeTruthy();
  });
  it('lets the OWNER preview their own draft', async () => {
    const { svc, repo } = build();
    repo.findById.mockResolvedValue(fakeListing({ status: 'draft', visibility: 'tenant', sellerUserId: 'owner-A' }));
    await expect(svc.getPublicById('t1', 'L1', { userId: 'owner-A', canModerate: false })).resolves.toBeTruthy();
  });
});
