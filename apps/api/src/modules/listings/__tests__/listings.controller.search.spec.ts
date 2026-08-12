// modules/listings/__tests__/listings.controller.search.spec.ts
// Unit tests for ListingsController.search — the `mine` ("my listings") wiring. GET /v1/listings is @Public (the
// anonymous storefront feed), but `mine=true` needs a real authenticated caller: with no bearer token,
// RequestContext.userId is '' (its documented anonymous-read convention — see request-context.ts), and the
// controller must 401 rather than silently querying with an empty owner id (which would return nothing, or worse,
// be misread as "no filter"). All infra mocked — proves the controller's wiring, not the SQL (see
// listing-search.read-model.spec.ts for that).
import { ListingsController } from '../controllers/listings.controller';
import { UnauthorizedError } from '../../../shared/errors/app-error';

function ctx(userId: string) {
  return { tenantId: 't1', userId, sessionId: '', requestId: 'r1', lang: 'en', roles: [], permissions: new Set<string>(), shardId: 0 } as any;
}

function build() {
  const searchRM: any = { query: jest.fn().mockResolvedValue({ items: [], total: null, nextCursor: null }) };
  const controller = new ListingsController(
    {} as any, {} as any, {} as any, searchRM, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,   // TENANT-2b: + bandRM, onBehalf
  );
  return { controller, searchRM };
}

describe('ListingsController.search — mine (owner view)', () => {
  it('mine=true with no authenticated caller (public/anonymous) → 401, never queries', async () => {
    const { controller, searchRM } = build();
    await expect(controller.search(ctx(''), { mine: true, limit: 20, sort: 'newest' } as any)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(searchRM.query).not.toHaveBeenCalled();
  });

  it('mine=true with an authenticated caller → passes ownerUserId = ctx.userId to the read-model', async () => {
    const { controller, searchRM } = build();
    await controller.search(ctx('seller-1'), { mine: true, limit: 20, sort: 'newest' } as any);
    expect(searchRM.query).toHaveBeenCalledWith('t1', expect.objectContaining({ mine: true }), { ownerUserId: 'seller-1' });
  });

  it('mine unset (public browse) → no ownerUserId passed, even when authenticated', async () => {
    const { controller, searchRM } = build();
    await controller.search(ctx('seller-1'), { limit: 20, sort: 'newest' } as any);
    expect(searchRM.query).toHaveBeenCalledWith('t1', expect.objectContaining({ limit: 20 }), {});
  });
});

// KV-MF-08: the Remove cta's HTTP edge. Same Idempotency-Key-required convention as :id/extend (this controller
// already enforces it there) — proves the WIRING (service mocked), not the domain/service logic (see
// listing.service.spec.ts's 'ListingService.archive' block for that).
describe('ListingsController.archive — KV-MF-08 (screen 112 Remove cta)', () => {
  function buildWithArchive() {
    const service: any = { archive: jest.fn().mockResolvedValue({ id: 'L1', status: 'archived' }) };
    const controller = new ListingsController(
      service, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,   // TENANT-2b: + bandRM, onBehalf
    );
    return { controller, service };
  }

  it('requires an Idempotency-Key header (BadRequestError otherwise), never calls the service', async () => {
    const { controller, service } = buildWithArchive();
    await expect(controller.archive(ctx('seller-1'), 'L1', '', {})).rejects.toBeTruthy();
    expect(service.archive).not.toHaveBeenCalled();
  });

  it('delegates to service.archive with the caller as actor (owner-only enforced downstream)', async () => {
    const { controller, service } = buildWithArchive();
    const res = await controller.archive(ctx('seller-1'), 'L1', 'idem-1', {});
    expect(service.archive).toHaveBeenCalledWith('t1', { userId: 'seller-1', canModerate: false }, 'idem-1', 'L1', undefined);
    expect(res).toEqual({ data: { id: 'L1', status: 'archived' } });
  });
});
