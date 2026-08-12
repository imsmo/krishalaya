// PC-56 TENANT-2b · W124 detail + W125 form — the trail read back, the reason that travels, the consent wall,
// and the QC queue's side door bricked up.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Listing } from '../domain/listing.entity';
import { DomainError } from '../../../shared/errors/app-error';
import { ListingService } from '../services/listing.service';
import { OnBehalfConsoleService, ON_BEHALF_LISTING_PURPOSE } from '../services/on-behalf-console.service';
import { ON_BEHALF_LISTING_PURPOSE as AMBASSADOR_PURPOSE } from '../../ambassadors/services/on-behalf-listing.service';
import { MandiBandReadModel } from '../read-models/mandi-band.read-model';

const codeOf = async (p: Promise<unknown>): Promise<string | null> => {
  try { await p; return null; } catch (e) { return e instanceof DomainError ? e.code : `<not domain: ${e}>`; }
};

const entity = (over: Record<string, unknown> = {}) => Listing.rehydrate({
  id: 'L1', tenantId: 't1', sellerUserId: 'seller-1', productId: 'p1', categoryId: 'c1',
  title: 'Lokwan wheat', quantityTotal: 18, quantityAvailable: 18, minOrderQty: 2, unitCode: 'quintal',
  priceMinor: 264000n, currencyCode: 'INR', organicClaim: 'none', status: 'published', saleType: 'direct',
  visibility: 'public', aiExtracted: false, version: 1, ...over,
} as any);

function makeTx() {
  return { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
}
function buildService(tx = makeTx()) {
  const uow: any = { run: jest.fn((_t: string, fn: any) => fn(tx)) };
  const deps: any[] = [
    uow,
    { write: jest.fn().mockResolvedValue(undefined) },                                   // outbox
    { assertWithinLimit: jest.fn(), increment: jest.fn() },                              // quota
    { remember: jest.fn((_k: string, _u: string, _o: string, fn: any) => fn()) },        // idem
    { del: jest.fn(), wrap: jest.fn((_k: string, _t: number, load: any) => load()), get: jest.fn(), set: jest.fn() }, // cache
    { inc: jest.fn(), observe: jest.fn() },                                              // metrics
    { insert: jest.fn(), update: jest.fn().mockResolvedValue(undefined), getForUpdate: jest.fn(), findById: jest.fn() }, // repo
    { append: jest.fn(), listForListing: jest.fn().mockResolvedValue([]) },              // priceHistory
    { upsertMany: jest.fn() },                                                           // attrs
    { attach: jest.fn(), photoAttachable: jest.fn(), countForListing: jest.fn(), attachOne: jest.fn() }, // media
    { write: jest.fn().mockResolvedValue(undefined) },                                   // audit
  ];
  const svc = new (ListingService as any)(...deps);
  return { svc, tx, outbox: deps[1], repo: deps[6], priceHistory: deps[7], audit: deps[10] };
}

/* ================================================================================================ */
describe('TENANT-2b · the way back on the aggregate', () => {
  it('redraft: rejected → draft (fix-and-relist) and pending_approval → draft (withdraw), the clock cleared', () => {
    const rej = entity({ status: 'rejected', rejectReason: 'photos_unclear' });
    rej.redraft();
    expect((rej.toProps() as any).status).toBe('draft');

    const waiting = entity({ status: 'pending_approval', qcSubmittedAt: new Date() });
    waiting.redraft();
    const p = waiting.toProps() as any;
    expect(p.status).toBe('draft');
    expect(p.qcSubmittedAt).toBeNull();                    // a listing not in the queue must not age in it
  });

  it('a fresh submission clears the previous teaching reason — the reviewer judges THIS submission', () => {
    const l = entity({ status: 'draft', rejectReason: 'photos_unclear' });
    l.submitForQc(new Date());
    expect((l.toProps() as any).rejectReason).toBeNull();
  });
});

/* ================================================================================================ */
describe('TENANT-2b · the service rules', () => {
  it('the bare publish VERB refuses from pending_approval — QC has no side door', async () => {
    const { svc, repo } = buildService();
    repo.getForUpdate.mockResolvedValue(entity({ status: 'pending_approval' }));
    expect(await codeOf(svc.publish('t1', { userId: 'seller-1', canModerate: false }, 'L1'))).toBe('LISTING_IN_QC');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('a STAFF archive without a reason is refused; the seller archiving their own needs none', async () => {
    const { svc, repo } = buildService();
    repo.getForUpdate.mockResolvedValue(entity());
    expect(await codeOf(svc.archive('t1', { userId: 'staff-9', canModerate: true }, 'k1', 'L1', ' hm ')))
      .toBe('LISTING_ARCHIVE_REASON');
    expect(repo.update).not.toHaveBeenCalled();

    repo.getForUpdate.mockResolvedValue(entity());
    await svc.archive('t1', { userId: 'seller-1', canModerate: false }, 'k2', 'L1');
    expect(repo.update).toHaveBeenCalledTimes(1);
  });

  it('a staff archive carries its reason in the EVENT the seller is notified with, and in audit', async () => {
    const { svc, repo, outbox, audit } = buildService();
    repo.getForUpdate.mockResolvedValue(entity());
    await svc.archive('t1', { userId: 'staff-9', canModerate: true }, 'k3', 'L1', 'duplicate of LST-88417');
    const archived = (outbox.write as jest.Mock).mock.calls.map((c) => c[1]).find((e) => e.eventType === 'listing.archived');
    expect(archived.payload).toMatchObject({ reason: 'duplicate of LST-88417', byStaff: true, sellerUserId: 'seller-1' });
    expect(audit.write).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'listing.archived', reason: 'duplicate of LST-88417' }));
  });

  it('the price trail is owner-or-moderator, 404 (not 403) to anyone else — no probing a seller’s pricing story', async () => {
    const { svc, repo, priceHistory } = buildService();
    repo.findById.mockResolvedValue(entity());
    expect(await codeOf(svc.priceTrail('t1', { userId: 'someone-else', canModerate: false }, 'L1'))).toBe('LISTING_NOT_FOUND');
    expect(priceHistory.listForListing).not.toHaveBeenCalled();
    await svc.priceTrail('t1', { userId: 'seller-1', canModerate: false }, 'L1');
    expect(priceHistory.listForListing).toHaveBeenCalledWith('t1', 'L1', 20);
  });

  it('create records the STAFF hand (created_by) and the harvest date — QC_OWN_DRAFT gets its identity', async () => {
    const { svc, repo } = buildService();
    await svc.create('t1', 'seller-1', 'k4', {
      productId: 'p1', categoryId: 'c1', title: 'Wheat lot', quantityTotal: 10, minOrderQty: 1, unitCode: 'quintal',
      priceMinor: '264000', currencyCode: 'INR', organicClaim: 'none', saleType: 'direct', visibility: 'tenant',
      harvestDate: '2026-03-15',
    } as any, 'staff-9');
    const inserted = (repo.insert as jest.Mock).mock.calls[0][1].toProps();
    expect(inserted.createdBy).toBe('staff-9');
    expect(inserted.harvestDate).toBe('2026-03-15');
  });

  it('the PUBLIC detail read strips the QC trail; the owner keeps it (the 2a leak, caught in-program)', async () => {
    const { svc, repo } = buildService();
    const full = entity({ status: 'published', visibility: 'public', rejectReason: null, createdBy: 'staff-9', qcSubmittedAt: new Date() });
    repo.findById.mockResolvedValue(full);
    const pub = await svc.getPublicById('t1', 'L1', { userId: 'stranger', canModerate: false });
    expect(pub).not.toHaveProperty('createdBy');
    expect(pub).not.toHaveProperty('qcSubmittedAt');
    expect(pub).not.toHaveProperty('rejectReason');
    const own = await svc.getPublicById('t1', 'L1', { userId: 'seller-1', canModerate: false });
    expect(own).toHaveProperty('createdBy', 'staff-9');
  });
});

/* ================================================================================================ */
describe('TENANT-2b · the consent wall (two doors, one law)', () => {
  function buildOnBehalf(granted: boolean) {
    const consents: any = { isGranted: jest.fn().mockResolvedValue(granted) };
    const listings: any = { create: jest.fn().mockResolvedValue({ id: 'L-new' }) };
    const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
    return { svc: new OnBehalfConsoleService(consents, listings, audit), consents, listings, audit };
  }

  it('no recorded consent → nothing is created, and the refusal names the law', async () => {
    const { svc, listings } = buildOnBehalf(false);
    await expect(svc.create('t1', { userId: 'staff-9' }, 'k1', 'member-3', {} as any)).rejects.toMatchObject({ code: 'LISTING_ONBEHALF_CONSENT' });
    expect(listings.create).not.toHaveBeenCalled();
  });

  it('consent granted → created WITH the staff identity, checked against the right member and actor, audited', async () => {
    const { svc, consents, listings, audit } = buildOnBehalf(true);
    await svc.create('t1', { userId: 'staff-9' }, 'k1', 'member-3', { title: 'x' } as any);
    expect(consents.isGranted).toHaveBeenCalledWith('t1', 'member-3', ON_BEHALF_LISTING_PURPOSE, 'staff-9');
    expect(listings.create).toHaveBeenCalledWith('t1', 'member-3', 'k1', { title: 'x' }, 'staff-9');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'listing.created_on_behalf' }));
  });

  it('the duplicated purpose code is PINNED EQUAL to the ambassador door’s — one law, asserted', () => {
    expect(ON_BEHALF_LISTING_PURPOSE).toBe(AMBASSADOR_PURPOSE);
  });
});

/* ================================================================================================ */
describe('TENANT-2b · the fair-price guide resolves honestly', () => {
  function buildBand(pincodeRow: { region_id: string | null } | undefined) {
    const pool = {
      calls: [] as string[],
      query: jest.fn((sql: string) => {
        (pool.calls as string[]).push(sql);
        if (sql.includes('FROM pincodes')) return Promise.resolve({ rows: pincodeRow ? [pincodeRow] : [], rowCount: pincodeRow ? 1 : 0 });
        return Promise.resolve({ rows: [{ low: 248000, modal: 261000, high: 276000, n: '12' }], rowCount: 1 });
      }),
    };
    const cache: any = { wrap: jest.fn((_k: string, _t: number, load: any) => load()) };
    const rm = new MandiBandReadModel({ forTenant: async () => pool } as any, cache);
    return { rm, pool };
  }

  it('resolves pincode → region → the SAME band read QC trusts', async () => {
    const { rm } = buildBand({ region_id: 'r-junagadh' });
    const g = await rm.bandForPincode('t1', 'p1', '362001');
    expect(g.regionId).toBe('r-junagadh');
    expect(g.band).toMatchObject({ lowMinor: '248000', modalMinor: '261000', highMinor: '276000', sampleSize: 12 });
  });

  it('an unmappable pincode returns NO band and never queries one — unknown is not a verdict', async () => {
    const { rm, pool } = buildBand(undefined);
    const g = await rm.bandForPincode('t1', 'p1', '999999');
    expect(g).toEqual({ band: null, regionId: null });
    expect(pool.calls.some((s: string) => s.includes('percentile_cont'))).toBe(false);
  });
});

/* ================================================================================================ */
describe('TENANT-2b · the routes and absences (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const src = () => strip(fs.readFileSync(path.join(__dirname, '..', 'controllers', 'listings.controller.ts'), 'utf8'));

  it("fair-price is declared BEFORE the ':id' route — a static segment must not be swallowed as an id", () => {
    const s = src();
    expect(s.indexOf("@Get('fair-price')")).toBeGreaterThan(-1);
    expect(s.indexOf("@Get('fair-price')")).toBeLessThan(s.indexOf("@Get(':id')"));
  });

  it('on-behalf needs listing.moderate (the staff-authority grant that already exists — nothing minted)', () => {
    const s = src();
    const onBehalf = s.slice(s.indexOf("@Post('on-behalf')"), s.indexOf('createOnBehalf'));
    expect(onBehalf).toContain('ListingPermissions.Moderate');
    expect(s).not.toContain("'listing.on_behalf'");
  });

  it('no migration was needed — 0005 already carried every column this wave reads and writes', () => {
    const dir = path.join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'migrations');
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('0139'))).toEqual([]);
  });
});
