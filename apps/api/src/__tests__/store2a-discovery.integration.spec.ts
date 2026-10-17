// apps/api/src/__tests__/store2a-discovery.integration.spec.ts · PC-56 STORE-2a — WHAT AN ANONYMOUS BUYER SEES IS TRUE AND PRIVATE, LIVE (the real
// AppModule over HTTP, real Postgres + RLS as kv_app; supertest drives the same middleware, guards, pipes and filter production runs).
//
// What it proves (brief §C8, the numbered list):
//   (1) price-sorted keyset pages are disjoint and complete (asc and desc, with tied prices), and a cursor minted under another sort is
//       refused by name (400 CURSOR_SORT_MISMATCH);
//   (2) the capped filtered count equals a direct count under a narrowing filter; the cap is honoured (1,001 rows → total 1001 = "1,000+",
//       facets withheld);
//   (3) the grade filter returns CONFIRMED grades only (never the AI suggestion); the organic split (certified · natural · any) and
//       `organic=false` = no filter (the z.coerce.boolean bug);
//   (4) the facet counts equal direct counts;
//   (5) the tombstone for sold_out / paused / expired / archived answers status (withdrawn for archived) + title and never a price; a draft
//       and a published lot 404;
//   (6) a suspended seller's lot 404s on the public detail (and leaves the feed); the owner still reads it;
//   (7) the feed rows carry no sellerUserId / regionId / lat / lng keys; the detail names the confirmed grade "graded by <org>", the district
//       only (never the taluka), quantityTotal and the attributes;
//   (8) storefront_browse OFF → 503 STOREFRONT_BROWSE_OFF on the feed, the detail, the tombstone, the attributes, the marker and the
//       organisation page — the owner's `mine` view is not gated; ON again → 200;
//   (9) the lot attributes are read for a published lot only;
//   (10) the regulated marker for a license_required product (national lock + banned states by name) and the empty marker for a plain one;
//        the feed row carries the lock;
//   (11) the organisation's reviews aggregate counts verified-purchase reviews only, when the flag is ON, and is absent (null) when OFF;
//   (12) sort=distance (and lat / pincode) refused by name;
//   + 0207.3: the platform's organisation name-prefix search returns verified live organisations only.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { PUBLIC_LISTING_KEYS, TOMBSTONE_KEYS } from '../modules/listings/domain/listing-public.view';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const JUNAGADH = '11111111-0000-7000-8000-000000000101';
const RAJKOT = '11111111-0000-7000-8000-000000000102';
const MAHARASHTRA = '11111111-0000-7000-8000-000000000002';
const GRADE_A = '66666666-0000-7000-8000-000000000003';
const PREMIUM = '66666666-0000-7000-8000-000000000002';
const LINK_KEYS = ['qrToken', 'auctionId', 'auctionStatus', 'auctionEndsAt'];

run('PC-56 STORE-2a · what an anonymous buyer sees is true and private (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const LIVE = randomUUID(); const UNVERIFIED = randomUUID();
  let slug = ''; let orgName = ''; let seller = ''; let seller2 = ''; let suspended = ''; let staff = ''; let buyer = '';
  let catKeyset = ''; let catFacets = ''; let catCap = ''; let catInputs = ''; let catChild = '';
  let product = ''; let productRegulated = '';
  let vanthali = '';
  const keyset: { id: string; price: number }[] = [];
  const L: Record<string, string> = {};
  const touched = ['storefront_browse', 'reviews'];
  const anon = () => ({ 'x-tenant-slug': slug });
  const get = (path: string) => request(http).get(path).set(anon());

  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [key, on]);
    for (const c of [`flag:${key}`, `flagstale:${key}`, 'flags:all', `flagctx:${LIVE}`]) await cache.del(c);
  };
  async function role(userId: string, tenantId: string, code: string): Promise<void> {
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, tenantId, code]);
  }
  async function category(name: string, parent?: string): Promise<string> {
    const code = 'c2a' + randomUUID().replace(/-/g, '').slice(0, 12);
    if (!parent) {
      return (await admin.query(`INSERT INTO categories (code, default_name, path, depth, is_active) VALUES ($1::text, $2::text, $1::text::ltree, 1, true) RETURNING id`, [code, name])).rows[0].id;
    }
    return (await admin.query(
      `INSERT INTO categories (code, parent_id, default_name, path, depth, is_active)
       SELECT $1::text, p.id, $2::text, p.path || $1::text, p.depth + 1, true FROM categories p WHERE p.id = $3 RETURNING id`, [code, name, parent])).rows[0].id;
  }
  type Opt = { title?: string; price?: number; status?: string; visibility?: string; region?: string; organic?: string; grade?: string | null;
    confirmed?: boolean; aiGrade?: string | null; seller?: string; category?: string; product?: string; createdAt?: string };
  async function listing(o: Opt = {}): Promise<string> {
    const r = await admin.query(
      `INSERT INTO listings (tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, min_order_qty, unit_code,
                             price_minor, currency_code, status, visibility, region_id, lat, lng, pincode, organic_claim, grade_option_id,
                             ai_grade_option_id, ai_grade_confidence, published_at, qc_reviewed_by, qc_reviewed_at, harvest_date, created_at)
       VALUES ($1, $2, $3, $4, $5::text, 40, 34, 5, 'quintal', $6, 'INR', $7::listing_status, $8::text, $9, 21.522222, 70.457777, '362001', $10::text, $11,
               $12, CASE WHEN $12::uuid IS NULL THEN NULL ELSE 0.9142 END, '2026-07-09T00:00:00Z',
               CASE WHEN $13::boolean THEN $14::uuid END, CASE WHEN $13::boolean THEN '2026-07-09T00:00:00Z'::timestamptz END, '2026-07-08',
               COALESCE($15::timestamptz, now()))
       RETURNING id`,
      [LIVE, o.seller ?? seller, o.product ?? product, o.category ?? catFacets, o.title ?? 'Lot 2a', o.price ?? 615000, o.status ?? 'published',
        o.visibility ?? 'public', o.region ?? JUNAGADH, o.organic ?? 'none', o.grade ?? null, o.aiGrade ?? null, o.confirmed === true, staff, o.createdAt ?? null]);
    return r.rows[0].id;
  }

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    orgName = `Kisan2a ${randomUUID().slice(0, 6)}`;
    await makeTenant(admin, LIVE, orgName); await makeTenant(admin, UNVERIFIED, `${orgName} Unverified`);
    await admin.query(`UPDATE tenants SET approved_at = now(), region_id = $2 WHERE id = $1`, [LIVE, JUNAGADH]);
    slug = (await admin.query(`SELECT slug FROM tenants WHERE id = $1`, [LIVE])).rows[0].slug;
    seller = await makeUser(admin); seller2 = await makeUser(admin); suspended = await makeUser(admin); staff = await makeUser(admin); buyer = await makeUser(admin);
    await admin.query(`UPDATE users SET full_name = 'Ramesh Patel 2a' WHERE id = $1`, [seller]);
    for (const u of [seller, seller2, suspended]) await role(u, LIVE, 'farmer');
    await role(staff, LIVE, 'tenant_staff'); await role(buyer, LIVE, 'customer');
    await admin.query(`INSERT INTO tenant_member_suspensions (tenant_id, user_id, reason, suspended_by) VALUES ($1, $2, 'store2a live spec: a suspended member seller', $3)`, [LIVE, suspended, staff]);
    vanthali = (await admin.query(
      `INSERT INTO admin_regions (country_code, parent_id, level, default_name, path, is_active)
       VALUES ('IN', $1, 3, 'Vanthali 2a', ('in.gj.junagadh.v' || substr(md5(random()::text), 1, 8))::ltree, true) RETURNING id`, [JUNAGADH])).rows[0].id;
    await admin.query(`INSERT INTO units (code, default_name, unit_class, is_active) VALUES ('quintal', 'Quintal', 'mass', true) ON CONFLICT (code) DO NOTHING`);
    catKeyset = await category('Keyset 2a'); catFacets = await category('Groundnut 2a'); catChild = await category('Bold 2a', catFacets);
    catCap = await category('Cap 2a'); catInputs = await category('Inputs 2a');
    product = (await admin.query(`INSERT INTO products (category_id, default_name, default_unit, is_active) VALUES ($1, 'Groundnut 2a', 'quintal', true) RETURNING id`, [catFacets])).rows[0].id;
    productRegulated = (await admin.query(`INSERT INTO products (category_id, default_name, default_unit, is_active) VALUES ($1, 'Chlorpyrifos 2a', 'quintal', true) RETURNING id`, [catInputs])).rows[0].id;
    await admin.query(`INSERT INTO regulated_product_rules (product_id, rule_type, payload) VALUES ($1, 'license_required', '{}'::jsonb)`, [productRegulated]);
    await admin.query(`INSERT INTO regulated_product_rules (product_id, rule_type, region_id, payload) VALUES ($1, 'banned_state', $2, '{}'::jsonb)`, [productRegulated, MAHARASHTRA]);
    // (1) seven lots in their own category with TIED prices — the keyset's hard case
    for (const [i, price] of [100, 200, 200, 300, 300, 300, 400].entries()) {
      keyset.push({ id: await listing({ category: catKeyset, price, title: `Keyset ${i}`, createdAt: `2030-02-01T00:00:00.00000${i}Z` }), price });
    }
    // (3)/(4) the facet world: confirmed grade A ×2 (one in a taluka of Junagadh), an AI-only suggestion, organic certified / natural, Rajkot
    L.confirmedA = await listing({ grade: GRADE_A, confirmed: true, organic: 'certified', title: 'Bold groundnut confirmed' });
    L.confirmedA2 = await listing({ grade: GRADE_A, confirmed: true, organic: 'natural', region: vanthali, category: catChild, title: 'Bold groundnut taluka' });
    L.aiOnly = await listing({ grade: PREMIUM, aiGrade: GRADE_A, confirmed: false, organic: 'natural', region: RAJKOT, title: 'AI-suggested groundnut' });
    L.plain = await listing({ title: 'Plain groundnut', region: RAJKOT });
    L.suspended = await listing({ seller: suspended, title: 'Suspended seller lot' });
    L.regulated = await listing({ product: productRegulated, category: catInputs, title: 'Chlorpyrifos 2a lot' });
    // (5) tombstones and the never-told states
    for (const s of ['sold_out', 'paused', 'expired', 'archived', 'draft', 'held']) L[s] = await listing({ status: s, title: `Lot ${s}`, category: catCap });
    // (9) attributes on a published lot and on a draft
    const attr = (await admin.query(`INSERT INTO attribute_definitions (code, default_name, data_type) VALUES ($1, 'Moisture 2a', 'decimal') RETURNING id`, ['m2a' + randomUUID().slice(0, 8)])).rows[0].id;
    await admin.query(`INSERT INTO listing_attribute_values (listing_id, attribute_id, value_number) VALUES ($1, $2, 7.800000), ($3, $2, 9.1)`, [L.confirmedA, attr, L.draft]);
    // (11) reviews of the organisation's sellers: two verified purchases (5★, 4★) and one that is not
    await admin.query(
      `INSERT INTO reviews (tenant_id, reviewer_user_id, target_type, target_id, stars, is_verified_purchase, status)
       VALUES ($1, $2, 'seller', $3, 5, true, 'published'), ($1, $2, 'seller', $4, 4, true, 'published'), ($1, $2, 'seller', $3, 1, false, 'published')`,
      [LIVE, buyer, seller, seller2]);
    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    await setFlag('storefront_browse', true); await setFlag('reviews', false);
  }, 240_000);
  afterAll(async () => {
    try { await admin?.query(`UPDATE feature_flags SET is_enabled = (key = 'storefront_browse') WHERE key = ANY($1::text[])`, [touched]); } catch { /* teardown only */ }
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  async function walk(sort: 'price_asc' | 'price_desc' | 'newest'): Promise<string[]> {
    const seen: string[] = []; let cursor: string | null = null; let guard = 0;
    do {
      const r: request.Response = await get(`/v1/listings?category=${catKeyset}&sort=${sort}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(r.status).toBe(200);
      seen.push(...r.body.data.map((x: { id: string }) => x.id));
      cursor = r.body.meta.nextCursor; guard += 1;
    } while (cursor && guard < 10);
    return seen;
  }

  it('(1) price-sorted keyset pages are disjoint and complete — asc and desc, tied prices; a foreign cursor is refused by name', async () => {
    const byAsc = [...keyset].sort((a, b) => a.price - b.price || (a.id < b.id ? -1 : 1)).map((x) => x.id);
    const byDesc = [...keyset].sort((a, b) => b.price - a.price || (a.id < b.id ? 1 : -1)).map((x) => x.id);
    const asc = await walk('price_asc'); const desc = await walk('price_desc'); const newest = await walk('newest');
    expect(asc).toEqual(byAsc);
    expect(desc).toEqual(byDesc);
    expect(new Set(asc).size).toBe(7);
    expect([...newest].sort()).toEqual([...byAsc].sort());
    const first = await get(`/v1/listings?category=${catKeyset}&sort=newest&limit=2`);
    const foreign = await get(`/v1/listings?category=${catKeyset}&sort=price_asc&limit=2&cursor=${encodeURIComponent(first.body.meta.nextCursor)}`);
    expect([foreign.status, foreign.body.error?.code]).toEqual([400, 'CURSOR_SORT_MISMATCH']);
  });

  it('(2) the capped filtered count equals a direct count under a narrowing filter; the cap is honoured (facets withheld above it)', async () => {
    const r = await get(`/v1/listings?category=${catFacets}&organic=any`);
    const direct = (await admin.query(
      `SELECT count(*)::int n FROM listings l WHERE l.tenant_id = $1 AND l.category_id IN (SELECT id FROM categories WHERE path <@ (SELECT path FROM categories WHERE id = $2))
          AND l.status = 'published' AND l.visibility IN ('public','cross_tenant') AND l.deleted_at IS NULL AND l.organic_claim IN ('certified','natural')
          AND NOT EXISTS (SELECT 1 FROM tenant_member_suspensions s WHERE s.tenant_id = l.tenant_id AND s.user_id = l.seller_user_id AND s.lifted_at IS NULL AND s.deleted_at IS NULL)`,
      [LIVE, catFacets])).rows[0].n;
    expect(direct).toBe(3);
    expect([r.body.meta.total, r.body.meta.totalCap]).toEqual([direct, 1000]);
    // 1,001 published lots in one category (one statement): the count stops at cap + 1 and the facets are withheld, not sampled
    await admin.query(
      `INSERT INTO listings (tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, unit_code, price_minor, currency_code, status, visibility)
       SELECT $1, $2, $3, $4, 'Cap lot ' || g, 10, 10, 'quintal', 1000 + g, 'INR', 'published', 'public' FROM generate_series(1, 1001) g`, [LIVE, seller, product, catCap]);
    const capped = await get(`/v1/listings?category=${catCap}&limit=1`);
    expect([capped.body.meta.total, capped.body.meta.totalCap, capped.body.meta.facets]).toEqual([1001, 1000, null]);
  });

  it('(3) grade = CONFIRMED only (the AI suggestion never counts); grade=none; the organic split; organic=false is no filter', async () => {
    const ids = async (qs: string) => ((await get(`/v1/listings?category=${catFacets}&${qs}`)).body.data as { id: string }[]).map((x) => x.id).sort();
    expect(await ids(`grade=${GRADE_A}`)).toEqual([L.confirmedA, L.confirmedA2].sort());
    expect(await ids(`grade=${PREMIUM}`)).toEqual([]);                                   // the premium on the AI lot was never confirmed
    expect(await ids('grade=none')).toEqual([L.aiOnly, L.plain].sort());
    // PC-56 STORE-5b · B18 (founder Q7): a listing CLAIMING `certified` with no verified organic certificate covering it is `self_declared` —
    // it is no longer in `organic=certified` (the read-time rule `CERTIFIED_SQL`); the fixture carries no certificate, so the list is empty.
    expect(await ids('organic=certified')).toEqual([]);
    expect(await ids('organic=natural')).toEqual([L.confirmedA2, L.aiOnly].sort());
    expect(await ids('organic=false')).toEqual([L.confirmedA, L.confirmedA2, L.aiOnly, L.plain].sort());
    expect((await get(`/v1/listings?organic=maybe`)).status).toBe(422);   // refused by the schema (the house validation status), never guessed
  });

  it('(4) the facet counts equal direct counts (grade confirmed, organic split, district — a taluka counts under its district)', async () => {
    const f = (await get(`/v1/listings?category=${catFacets}`)).body.meta.facets;
    expect(f.grade).toEqual([{ id: GRADE_A, name: 'Grade A', count: 2 }]);
    expect(f.ungraded).toBe(2);
    // PC-56 STORE-5b · B18 (founder Q7): the facet counts `certified` only when a verified organic certificate covers the lot; the bare claim
    // counts under the new `selfDeclared` key.
    expect(f.organic).toEqual({ certified: 0, selfDeclared: 1, natural: 2, none: 1 });
    expect(f.district.map((d: { name: string; count: number }) => [d.name, d.count]).sort()).toEqual([['Junagadh', 2], ['Rajkot', 2]]);
    expect(f.saleType).toEqual([{ id: 'direct', count: 4 }]);
    const district = await get(`/v1/listings?category=${catFacets}&district=${JUNAGADH}`);
    expect((district.body.data as { id: string }[]).map((x) => x.id).sort()).toEqual([L.confirmedA, L.confirmedA2].sort());
  });

  it('(5) the tombstone: sold_out / paused / expired / withdrawn with the title and NEVER a price; draft, held and published 404', async () => {
    for (const [s, told] of [['sold_out', 'sold_out'], ['paused', 'paused'], ['expired', 'expired'], ['archived', 'withdrawn']]) {
      const r = await get(`/v1/listings/${L[s]}/tombstone`);
      expect([s, r.status]).toEqual([s, 200]);
      expect(r.body.data).toMatchObject({ id: L[s], tombstone: true, status: told, title: `Lot ${s}`, organisation: { slug, name: orgName } });
      expect(Object.keys(r.body.data).sort()).toEqual([...TOMBSTONE_KEYS].sort());
      expect(JSON.stringify(r.body.data)).not.toMatch(/price|Minor|quantity|615000/i);
      expect((await get(`/v1/listings/${L[s]}`)).status).toBe(404);                      // the detail still 404s it
    }
    for (const s of ['draft', 'held']) expect([s, (await get(`/v1/listings/${L[s]}/tombstone`)).status]).toEqual([s, 404]);
    expect((await get(`/v1/listings/${L.plain}/tombstone`)).status).toBe(404);
  });

  it('(6) a SUSPENDED seller\'s lot 404s on the detail and is absent from the feed; the owner still reads it', async () => {
    expect((await get(`/v1/listings/${L.suspended}`)).status).toBe(404);
    const feed = (await get(`/v1/listings?category=${catFacets}&limit=50`)).body.data as { id: string }[];
    expect(feed.map((x) => x.id)).not.toContain(L.suspended);
    const own = mintToken(app, { userId: suspended, tenantId: LIVE, roles: ['farmer'], perms: [] });
    expect((await request(http).get(`/v1/listings/${L.suspended}`).set({ authorization: `Bearer ${own}`, 'x-tenant-id': LIVE })).status).toBe(200);
  });

  it('(7) the feed carries no seller / region uuid and no coordinates; the detail: confirmed grade "graded by <org>", district only, quantityTotal, attributes', async () => {
    const feed = await get(`/v1/listings?category=${catFacets}`);
    for (const row of feed.body.data) {
      for (const k of ['sellerUserId', 'regionId', 'lat', 'lng', 'pincode', 'tenantId']) expect([k, k in row]).toEqual([k, false]);
      expect(row.organisation).toEqual({ slug, name: orgName });
    }
    const a2 = feed.body.data.find((x: { id: string }) => x.id === L.confirmedA2);
    expect([a2.grade, a2.district, a2.organic]).toEqual(['Grade A', 'Junagadh', 'natural']);   // the taluka is never named
    const ai = feed.body.data.find((x: { id: string }) => x.id === L.aiOnly);
    expect(ai.grade).toBeNull();
    const d = await get(`/v1/listings/${L.confirmedA}`);
    expect(d.status).toBe(200);
    expect(Object.keys(d.body.data).sort()).toEqual([...PUBLIC_LISTING_KEYS, ...LINK_KEYS].sort());
    expect(d.body.data.gradeConfirmed).toEqual({ name: 'Grade A', gradedBy: orgName });
    expect([d.body.data.quantityTotal, d.body.data.quantityAvailable, d.body.data.district]).toEqual([40, 34, 'Junagadh']);
    expect(d.body.data.attributes).toEqual([{ code: expect.any(String), name: 'Moisture 2a', kind: 'number', value: '7.8', unit: null }]);
    expect(JSON.stringify(d.body.data)).not.toMatch(/Ramesh|21\.52|70\.45|362001|0\.9142/);
    const unconfirmed = (await get(`/v1/listings/${L.aiOnly}`)).body.data;
    expect([unconfirmed.grade, unconfirmed.gradeConfirmed]).toEqual([null, null]);
  });

  it('(8) storefront_browse OFF → 503 STOREFRONT_BROWSE_OFF on every public read (the owner\'s own view is not the storefront); ON → 200', async () => {
    const paths = [`/v1/listings`, `/v1/listings/${L.confirmedA}`, `/v1/listings/${L.sold_out}/tombstone`, `/v1/listings/${L.confirmedA}/attributes`,
      `/v1/listings/${L.regulated}/regulated`, `/v1/sellers/organisation`];
    await setFlag('storefront_browse', false);
    try {
      for (const p of paths) {
        const r = await get(p);
        expect([p, r.status, r.body.error?.code]).toEqual([p, 503, 'STOREFRONT_BROWSE_OFF']);
      }
      const f = await get('/v1/storefront/flags');
      expect(f.body.data.storefront_browse).toBe(false);
      const own = mintToken(app, { userId: seller, tenantId: LIVE, roles: ['farmer'], perms: [] });
      expect((await request(http).get('/v1/listings?mine=true').set({ authorization: `Bearer ${own}`, 'x-tenant-id': LIVE })).status).toBe(200);
    } finally { await setFlag('storefront_browse', true); }
    for (const p of paths) expect([p, (await get(p)).status]).toEqual([p, 200]);
    expect((await get('/v1/storefront/flags')).body.data.storefront_browse).toBe(true);
  });

  it('(9) the lot attributes are read for a PUBLISHED lot only', async () => {
    expect((await get(`/v1/listings/${L.confirmedA}/attributes`)).body.data).toEqual([{ code: expect.any(String), name: 'Moisture 2a', kind: 'number', value: '7.8', unit: null }]);
    expect((await get(`/v1/listings/${L.draft}/attributes`)).body.data).toEqual([]);
  });

  it('(10) the regulated marker: a license_required product → the lock + the banned state by NAME; a plain lot → the empty marker; the feed row carries the lock', async () => {
    expect((await get(`/v1/listings/${L.regulated}/regulated`)).body.data).toEqual({ licenceRequired: true, licenceRequiredIn: [], bannedRegions: ['Maharashtra'], safetyLabel: null });
    expect((await get(`/v1/listings/${L.plain}/regulated`)).body.data).toEqual({ licenceRequired: false, licenceRequiredIn: [], bannedRegions: [], safetyLabel: null });
    const row = ((await get(`/v1/listings?category=${catInputs}`)).body.data as { id: string; licenceRequired: boolean }[]).find((x) => x.id === L.regulated);
    expect(row?.licenceRequired).toBe(true);
    expect((await get(`/v1/listings/${L.draft}/regulated`)).status).toBe(404);
  });

  it('(11) the organisation page: profile + capped count; the reviews aggregate ONLY with the flag ON, verified purchases only, no identity', async () => {
    let r = await get('/v1/sellers/organisation');
    expect(r.status).toBe(200);
    expect(r.body.data.profile).toMatchObject({ displayName: orgName, verified: true, district: 'Junagadh' });
    expect(r.body.data.reviews).toBeNull();
    await setFlag('reviews', true);
    try {
      r = await get('/v1/sellers/organisation');
      expect(r.body.data.reviews).toEqual({ avg: 4.5, count: 2, capped: false, cap: 1000 });   // the unverified 1★ is not counted
      expect(JSON.stringify(r.body.data)).not.toMatch(new RegExp(`${buyer}|${seller}|Ramesh`));
    } finally { await setFlag('reviews', false); }
  });

  it('(12) sort=distance, sort=relevance and the location inputs are refused by name (400), never silently ignored', async () => {
    for (const [qs, code] of [['sort=distance', 'DISTANCE_SORT_REFUSED'], ['sort=relevance', 'RELEVANCE_SORT_REFUSED'], ['lat=21.5&lng=70.4', 'LOCATION_FILTER_REFUSED'], ['pincode=362001', 'LOCATION_FILTER_REFUSED']]) {
      const r = await get(`/v1/listings?${qs}`);
      expect([qs, r.status, r.body.error?.code]).toEqual([qs, 400, code]);
    }
  });

  it('0207.3: the platform\'s organisation search by name prefix returns verified live organisations only', async () => {
    const prefix = orgName.slice(0, 10).toLowerCase();
    const r = await request(http).get(`/v1/storefront/organisations?q=${encodeURIComponent(prefix)}`);
    expect(r.status).toBe(200);
    const slugs = (r.body.data as { slug: string }[]).map((o) => o.slug);
    expect(slugs).toContain(slug);
    expect(slugs).not.toContain((await admin.query(`SELECT slug FROM tenants WHERE id = $1`, [UNVERIFIED])).rows[0].slug);   // not approved
    expect((await request(http).get('/v1/storefront/organisations?q=%25')).body.data.length).toBeLessThanOrEqual(24);       // LIKE metacharacters are literal / too short
  });
});
