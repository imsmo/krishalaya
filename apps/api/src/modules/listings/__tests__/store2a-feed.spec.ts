// modules/listings/__tests__/store2a-feed.spec.ts · PC-56 STORE-2a — the mocked half of "what an anonymous buyer sees is true and private"
// (the live half is src/__tests__/store2a-discovery.integration.spec.ts). Proves, on the SQL text and the pure pieces:
//   B1  the keyset per sort (a price cursor pages price_minor, never created_at; a cursor of another sort is refused by name); the organic
//       split coercion ("false" is false); distance / relevance / lat / lng / pincode refused by name; the public row carries no seller or
//       region uuid; the capped count + facets come from ONE bounded statement and the facets are withheld above the cap;
//   B2  the tombstone has no price and no quantity, and only four statuses answer; the confirmed-grade predicate is the QC review of the
//       current window and never reads the AI column; a suspended seller's detail 404s;
//   B4  the kill-switch: OFF → 503 STOREFRONT_BROWSE_OFF; a flag-store failure → open; the owner's `mine` view is not gated;
//   B5  the regulated marker from rules (national lock vs state names).
import { ListingSearchReadModel, decodeFeedCursor, encodeFeedCursor, refuseUnsupported, PUBLIC_LISTING_COUNT_CAP } from '../read-models/listing-search.read-model';
import { QueryListingSchema } from '../dto/query-listing.dto';
import { toListingTombstone, TOMBSTONE_KEYS, toPublicListing, PUBLIC_LISTING_KEYS } from '../domain/listing-public.view';
import { confirmedGradeIdSql, licenceRequiredSql } from '../read-models/public-listing.sql';
import { StorefrontBrowseGate, StorefrontBrowseGuard } from '../storefront-browse.guard';
import { markerFromRules } from '../read-models/listing-regulated.read-model';
import { ListingsController } from '../controllers/listings.controller';
import { ListingService } from '../services/listing.service';
import type { ListingProps } from '../domain/listing.entity';

const T = '0207a000-0000-7000-8000-000000000001';
const L1 = '0207a000-0000-7000-8000-0000000000a1';
const parse = (q: Record<string, unknown>) => QueryListingSchema.parse({ limit: '20', ...q });

function build(pageRows: unknown[] = [], countRow: unknown = { total: 2, members_only: 0, grades: [], ungraded: 2, organic: { certified: 0, natural: 1, none: 1 }, districts: [] }) {
  const query = jest.fn().mockResolvedValueOnce({ rows: pageRows }).mockResolvedValueOnce({ rows: [countRow] });
  const rm = new ListingSearchReadModel({ forTenant: () => ({ query }) } as never, { inc: jest.fn(), observe: jest.fn() } as never);
  return { rm, query };
}

describe('STORE-2a · B1 — the keyset is per sort key', () => {
  it('price_asc pages on (price_minor, id) ascending — never on created_at; the next cursor carries the price', async () => {
    const rows = [1, 2, 3].map((i) => ({ id: `0207a000-0000-7000-8000-00000000000${i}`, title: 't', price_minor: String(100 * i), currency_code: 'INR', unit_code: 'quintal',
      quantity_available: '1', organic_claim: 'none', sale_type: 'direct', created_us: '2030-01-01T00:00:00.000001Z', status: 'published' }));
    const { rm, query } = build(rows);
    const first = await rm.query(T, parse({ sort: 'price_asc', limit: '2' }));
    expect(query.mock.calls[0][0]).toMatch(/ORDER BY l\.price_minor ASC, l\.id ASC/);
    const c = decodeFeedCursor(first.nextCursor ?? undefined, 'price_asc');
    expect(c).toEqual({ s: 'price_asc', v: '200', id: '0207a000-0000-7000-8000-000000000002' });
    const { rm: rm2, query: q2 } = build();
    await rm2.query(T, parse({ sort: 'price_asc', cursor: first.nextCursor }));
    expect(q2.mock.calls[0][0]).toMatch(/\(l\.price_minor, l\.id\) > \(\$\d+::bigint, \$\d+::uuid\)/);
    expect(q2.mock.calls[0][0]).not.toMatch(/l\.created_at, l\.id\) </);
  });
  it('price_desc pages (price_minor, id) < ; newest pages (created_at µs, id) < with the µs instant the DB printed', async () => {
    const { rm, query } = build();
    await rm.query(T, parse({ sort: 'price_desc', cursor: encodeFeedCursor({ s: 'price_desc', v: '500', id: L1 }) }));
    expect(query.mock.calls[0][0]).toMatch(/\(l\.price_minor, l\.id\) < \(\$\d+::bigint/);
    const { rm: rm2, query: q2 } = build();
    await rm2.query(T, parse({ cursor: encodeFeedCursor({ s: 'newest', v: '2030-01-01T00:00:00.123456Z', id: L1 }) }));
    expect(q2.mock.calls[0][0]).toMatch(/\(l\.created_at, l\.id\) < \(\$\d+::timestamptz/);
    expect(q2.mock.calls[0][1]).toContain('2030-01-01T00:00:00.123456Z');
  });
  it('a cursor minted under ANOTHER sort is refused by name (400 CURSOR_SORT_MISMATCH); a malformed / legacy one is page one', () => {
    const newest = encodeFeedCursor({ s: 'newest', v: '2030-01-01T00:00:00.123456Z', id: L1 });
    expect(() => decodeFeedCursor(newest, 'price_asc')).toThrow(expect.objectContaining({ code: 'CURSOR_SORT_MISMATCH', httpStatus: 400 }));
    expect(decodeFeedCursor('not-base64-json', 'newest')).toBeUndefined();
    expect(decodeFeedCursor(Buffer.from(JSON.stringify({ c: '2030-01-01T00:00:00.000Z', id: L1 })).toString('base64url'), 'newest')).toBeUndefined();
    expect(decodeFeedCursor(encodeFeedCursor({ s: 'price_asc', v: '12.5', id: L1 }), 'price_asc')).toBeUndefined();   // a price is integer minor units
  });
});

describe('STORE-2a · B1 — the query grammar', () => {
  it('organic: "false" is FALSE (no filter) — the z.coerce.boolean bug; the split certified | natural | any; legacy truthy → any; junk refused', () => {
    expect(parse({ organic: 'false' }).organic).toBeUndefined();
    expect(parse({ organic: '0' }).organic).toBeUndefined();
    expect(parse({ organic: 'true' }).organic).toBe('any');
    expect(parse({ organic: '1' }).organic).toBe('any');
    expect(parse({ organic: 'certified' }).organic).toBe('certified');
    expect(parse({ organic: 'natural' }).organic).toBe('natural');
    expect(QueryListingSchema.safeParse({ organic: 'maybe' }).success).toBe(false);
    expect(parse({ mine: 'false' }).mine).toBe(false);   // the same coercion bug on `mine`
    expect(parse({ mine: 'true' }).mine).toBe(true);
  });
  it('distance, relevance and the location inputs are REFUSED by name (400), never silently ignored', () => {
    expect(() => refuseUnsupported(parse({ sort: 'distance' }))).toThrow(expect.objectContaining({ code: 'DISTANCE_SORT_REFUSED', httpStatus: 400 }));
    expect(() => refuseUnsupported(parse({ sort: 'relevance' }))).toThrow(expect.objectContaining({ code: 'RELEVANCE_SORT_REFUSED' }));
    for (const loc of [{ lat: '21.5' }, { lng: '70.4' }, { pincode: '362001' }]) {
      expect(() => refuseUnsupported(parse(loc))).toThrow(expect.objectContaining({ code: 'LOCATION_FILTER_REFUSED' }));
    }
    expect(() => refuseUnsupported(parse({ sort: 'price_asc' }))).not.toThrow();
  });
  it('the filters: grade (a CONFIRMED grade, or none), the organic split, a category SUBTREE, a district SUBTREE', async () => {
    const G = '0207a000-0000-7000-8000-0000000000c1';
    const { rm, query } = build();
    await rm.query(T, parse({ grade: G, organic: 'certified', category: G, district: G }));
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain(`${confirmedGradeIdSql('l')} = $`);
    // PC-56 STORE-5b · B18: `organic=certified` is the BADGE RULE now (the claim AND a covering certificate — read-models/certified.sql.ts)
    expect(sql).toContain(`(l.organic_claim = 'certified' AND EXISTS (SELECT 1 FROM certificates kvcert`);
    expect(sql).toMatch(/kvc\.path <@ \(SELECT kvp\.path FROM categories kvp/);
    expect(sql).toMatch(/kvr\.path <@ \(SELECT kvp\.path FROM admin_regions kvp/);
    const { rm: rm2, query: q2 } = build();
    await rm2.query(T, parse({ grade: 'none', organic: 'any' }));
    expect(q2.mock.calls[0][0]).toContain(`${confirmedGradeIdSql('l')} IS NULL`);
    expect(q2.mock.calls[0][0]).toMatch(/l\.organic_claim IN \('certified','natural'\)/);
  });
});

describe('STORE-2a · B1 — the public row and the count', () => {
  const row = { id: L1, title: 'GG-20', price_minor: '615000', currency_code: 'INR', unit_code: 'quintal', quantity_available: '34', organic_claim: 'natural',
    sale_type: 'direct', region_id: 'R-uuid', seller_user_id: 'U-farmer', created_us: '2030-01-01T00:00:00.000001Z', status: 'published',
    org_slug: 'anand-fpo', org_name: 'Anand FPO', grade_name: 'Grade A', district_name: 'Junagadh', licence_required: true };
  it('names the organisation, the confirmed grade, the district and the lock — and carries NO sellerUserId / regionId', async () => {
    const { rm } = build([row]);
    const r = await rm.query(T, parse({}));
    expect(r.items[0]).toEqual({ id: L1, title: 'GG-20', priceMinor: '615000', currencyCode: 'INR', unitCode: 'quintal', quantityAvailable: 34,
      organicClaim: true, organic: 'natural', saleType: 'direct', status: 'published', boosted: false, grade: 'Grade A', district: 'Junagadh',
      organisation: { slug: 'anand-fpo', name: 'Anand FPO' }, licenceRequired: true });
    for (const k of ['sellerUserId', 'regionId', 'lat', 'lng', 'pincode']) expect(r.items[0]).not.toHaveProperty(k);
  });
  it('the owner view keeps its own record shape (its own id and region) and never counts', async () => {
    const q = jest.fn().mockResolvedValueOnce({ rows: [row] });
    const rm = new ListingSearchReadModel({ forTenant: () => ({ query: q }) } as never, { inc: jest.fn(), observe: jest.fn() } as never);
    const r = await rm.query(T, parse({ mine: 'true' }), { ownerUserId: 'U-farmer' });
    expect(r.items[0]).toMatchObject({ sellerUserId: 'U-farmer', regionId: 'R-uuid' });
    expect(q).toHaveBeenCalledTimes(1);
  });
  it('within the cap: the exact count and the facets; above it: "cap+" and the facets WITHHELD (null), never a sample', async () => {
    const within = build([], { total: 3, members_only: 0, grades: [{ id: 'g1', name: 'Grade A', count: 2 }], ungraded: 1, organic: { certified: 1, natural: 1, none: 1 }, districts: [{ id: 'd1', name: 'Junagadh', count: 3 }], sale_types: [{ id: 'direct', count: 3 }] });
    const a = await within.rm.query(T, parse({ q: 'groundnut' }));
    expect(a.total).toBe(3);
    // PC-56 STORE-5b · B18: + `selfDeclared` (certified claims without a covering certificate; `certified` counts covered lots only)
    expect(a.facets).toEqual({ grade: [{ id: 'g1', name: 'Grade A', count: 2 }], ungraded: 1, organic: { certified: 1, selfDeclared: 0, natural: 1, none: 1 }, district: [{ id: 'd1', name: 'Junagadh', count: 3 }], saleType: [{ id: 'direct', count: 3 }] });
    const above = build([], { total: PUBLIC_LISTING_COUNT_CAP + 1, members_only: 0, grades: null, ungraded: null, organic: null, districts: null });
    const b = await above.rm.query(T, parse({}));
    expect([b.total, b.totalCap, b.facets]).toEqual([1001, 1000, null]);
    // ONE statement, bounded by the cap
    expect(above.query).toHaveBeenCalledTimes(2);
    expect(above.query.mock.calls[1][0]).toMatch(/LIMIT \$\d+::int \+ 1/);
    expect(above.query.mock.calls[1][0]).toMatch(/CASE WHEN n\.total <= \$\d+::int THEN/);
  });
});

describe('STORE-2a · B2 — the confirmed grade, the tombstone, the detail', () => {
  it('the confirmed grade is the QC review of the CURRENT window, and the AI column is never read', () => {
    const sql = confirmedGradeIdSql('l');
    expect(sql).toMatch(/l\.qc_reviewed_by IS NOT NULL/);
    expect(sql).toMatch(/l\.qc_reviewed_at >= l\.published_at/);
    expect(sql).not.toMatch(/ai_grade/);
  });
  it('the regulated lock reads NATIONAL license_required rules of the product or the category branch', () => {
    const sql = licenceRequiredSql('l', '$9');
    expect(sql).toMatch(/rule_type = 'license_required'/);
    expect(sql).toMatch(/region_id IS NULL/);
    expect(sql).toMatch(/kva\.path @> /);
  });
  it('the tombstone: four statuses answer (archived → withdrawn); NO price, NO quantity; everything else is null (404)', () => {
    const base = { id: L1, title: 'GG-20', orgSlug: 'anand-fpo', orgName: 'Anand FPO', categoryId: 'c1', categoryName: 'Groundnut' };
    expect(toListingTombstone({ ...base, status: 'sold_out' })).toEqual({ id: L1, tombstone: true, status: 'sold_out', title: 'GG-20',
      organisation: { slug: 'anand-fpo', name: 'Anand FPO' }, category: { id: 'c1', name: 'Groundnut' } });
    expect(toListingTombstone({ ...base, status: 'archived' })?.status).toBe('withdrawn');
    expect(toListingTombstone({ ...base, status: 'paused' })?.status).toBe('paused');
    expect(toListingTombstone({ ...base, status: 'expired' })?.status).toBe('expired');
    for (const s of ['published', 'draft', 'pending_approval', 'rejected', 'hidden', 'held', 'reserved_auction']) expect(toListingTombstone({ ...base, status: s })).toBeNull();
    expect([...TOMBSTONE_KEYS].sort()).toEqual(['category', 'id', 'organisation', 'status', 'title', 'tombstone']);
    expect(TOMBSTONE_KEYS).not.toContain('priceMinor' as never);
  });
  it('the public view gains quantityTotal, gradeConfirmed ("graded by <org> staff") and attributes — and only those', () => {
    const props = { id: L1, tenantId: T, sellerUserId: 'U', productId: 'P', categoryId: 'C', title: 'GG-20', description: null, quantityTotal: 40,
      quantityAvailable: 34, minOrderQty: 5, unitCode: 'quintal', priceMinor: 615000n, currencyCode: 'INR', organicClaim: 'natural', status: 'published',
      saleType: 'direct', visibility: 'public', aiExtracted: true, version: 1 } as unknown as ListingProps;
    const v = toPublicListing(props, { organisation: { slug: 'anand-fpo', name: 'Anand FPO' }, district: 'Junagadh', grade: 'Grade A',
      attributes: [{ code: 'moisture_pct', name: 'Moisture', kind: 'number', value: '7.8', unit: '%' }] });
    expect(Object.keys(v).sort()).toEqual([...PUBLIC_LISTING_KEYS].sort());
    expect([v.quantityTotal, v.gradeConfirmed]).toEqual([40, { name: 'Grade A', gradedBy: 'Anand FPO' }]);
    expect(v.attributes).toEqual([{ code: 'moisture_pct', name: 'Moisture', kind: 'number', value: '7.8', unit: '%' }]);
    expect(toPublicListing(props, { organisation: null, district: null, grade: null }).gradeConfirmed).toBeNull();
  });
  it('a SUSPENDED seller\'s lot 404s on the public detail (the owner still reads it)', async () => {
    const lot = { id: L1, sellerUserId: 'U', status: 'published', visibility: 'public' };
    const facts = { sellerSuspended: jest.fn().mockResolvedValue(true), forListing: jest.fn() };
    const svc = Object.create(ListingService.prototype) as ListingService;
    Object.assign(svc, { cache: { wrap: async () => lot }, publicFacts: facts, browseGate: { assertOpen: async () => undefined } });
    await expect(svc.getPublicById(T, L1, { userId: '', canModerate: false })).rejects.toMatchObject({ httpStatus: 404 });
    expect(facts.forListing).not.toHaveBeenCalled();
    await expect(svc.getPublicById(T, L1, { userId: 'U', canModerate: false })).resolves.toBe(lot);
  });
});

describe('STORE-2a · B4 — the catalogue kill-switch', () => {
  const gate = (on: boolean | 'throw') => new StorefrontBrowseGate({ isEnabled: jest.fn(async () => { if (on === 'throw') throw new Error('flags down'); return on; }) } as never);
  it('OFF → 503 STOREFRONT_BROWSE_OFF (named); ON → open; a flag-store failure → OPEN (fail open, the header says why)', async () => {
    await expect(gate(false).assertOpen()).rejects.toMatchObject({ code: 'STOREFRONT_BROWSE_OFF', httpStatus: 503 });
    await expect(gate(true).assertOpen()).resolves.toBeUndefined();
    await expect(gate('throw').assertOpen()).resolves.toBeUndefined();
    await expect(new StorefrontBrowseGuard(gate(false)).canActivate()).rejects.toMatchObject({ code: 'STOREFRONT_BROWSE_OFF' });
  });
  it('the platform switch is evaluated with no tenant ({}) — the same context the flags endpoint uses', async () => {
    const isEnabled = jest.fn(async () => true);
    await new StorefrontBrowseGate({ isEnabled } as never).assertOpen();
    expect(isEnabled).toHaveBeenCalledWith('storefront_browse', {});
  });
  it('the feed is gated; the owner\'s own `mine` view is not; the detail\'s non-owner branch is', async () => {
    const searchRM = { query: jest.fn().mockResolvedValue({ items: [], total: null, nextCursor: null }) };
    const off = { assertOpen: jest.fn().mockRejectedValue(Object.assign(new Error('off'), { code: 'STOREFRONT_BROWSE_OFF' })) };
    const ctl = new ListingsController({} as never, {} as never, {} as never, searchRM as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, off as never, {} as never, {} as never, {} as never);
    const ctx = (userId: string) => ({ tenantId: T, userId }) as never;
    await expect(ctl.search(ctx(''), parse({}))).rejects.toMatchObject({ code: 'STOREFRONT_BROWSE_OFF' });
    await expect(ctl.search(ctx('U'), parse({ mine: 'true' }))).resolves.toBeTruthy();
    const svc = Object.create(ListingService.prototype) as ListingService;
    Object.assign(svc, { cache: { wrap: async () => ({ id: L1, sellerUserId: 'U', status: 'published', visibility: 'public' }) }, browseGate: off });
    await expect(svc.getPublicById(T, L1, { userId: '', canModerate: false })).rejects.toMatchObject({ code: 'STOREFRONT_BROWSE_OFF' });
    await expect(svc.getPublicById(T, L1, { userId: 'U', canModerate: false })).resolves.toMatchObject({ id: L1 });
  });
});

describe('STORE-2a · B5 — the regulated marker', () => {
  it('a national licence rule → the lock; state-scoped rules → names; a safety label passes through; nothing → the empty marker', () => {
    expect(markerFromRules([
      { ruleType: 'license_required', regionName: null, regional: false, label: null },
      { ruleType: 'license_required', regionName: 'Maharashtra', regional: true, label: null },
      { ruleType: 'banned_state', regionName: 'Kerala', regional: true, label: null },
      { ruleType: 'banned_state', regionName: 'Kerala', regional: true, label: null },
      { ruleType: 'safety_label', regionName: null, regional: false, label: ' Red triangle — highly toxic ' },
    ])).toEqual({ licenceRequired: true, licenceRequiredIn: ['Maharashtra'], bannedRegions: ['Kerala'], safetyLabel: 'Red triangle — highly toxic' });
    expect(markerFromRules([{ ruleType: 'license_required', regionName: 'Gujarat', regional: true, label: null }]).licenceRequired).toBe(false);
    expect(markerFromRules([])).toEqual({ licenceRequired: false, licenceRequiredIn: [], bannedRegions: [], safetyLabel: null });
  });
});
