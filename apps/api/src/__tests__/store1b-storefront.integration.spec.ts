// apps/api/src/__tests__/store1b-storefront.integration.spec.ts · PC-56 STORE-1b — THE PLATFORM HOME AND THE TENANT HOME, LIVE (the real
// AppModule over HTTP, real Postgres + RLS, kv_app; supertest drives the same middleware, guards, pipes and filter production runs).
//
// What it proves (brief §C6 / §D4):
//   D4/A2  an ANONYMOUS caller cannot see a TRIAL organisation (storefront/tenant, storefront/branding, the listing feed → 404
//          TENANT_NOT_FOUND) while the trial tenant's own admin (JWT) still reads; a bearer that did not verify gets NO tenant context
//          (a protected route answers 401, not 404); kill-switch storefront_trial_visible ON → visible again;
//   A3     a reserved name: signup skips it ("Cart" → cart-2); a name the DB list has and the code list lacks → SIGNUP_SLUG_RESERVED
//          (service); a raw kv_app INSERT with slug `login` and an owner UPDATE of a slug to `login` are refused by the trigger;
//   A1     public_tenant_profile returns ONLY the approved columns, and nothing for a trial / suspended tenant;
//   A5     the discovery feed returns ONLY cross_tenant published listings of LIVE tenants (a `tenant`-visibility listing, a draft and a
//          trial tenant's listing are absent), keyset in microseconds — no row twice over three pages; the directory pages verified live
//          organisations only;
//   A4/B3  the stats job's refresh, then the read: counts equal a hand query, computedAt set, the job is registered;
//   B2     the flags endpoint returns `group_lots` (a boolean) and — since STORE-1c — the platform switch `org_self_signup`, nothing else; the listing feed's capped total + members-only count
//          (the cap proven PARAMETERISED — public_tenant_listing_count(tenant, 2) on three rows answers 3 = "more than 2" — because
//          inserting 1,001 listings would only prove the same LIMIT at a slower speed).
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { OTP_SERVICE, OtpService } from '../core/auth/otp.service';
import { ScheduledJobRegistry } from '../core/jobs/scheduled-job.registry';
import { StorefrontPublicStatsJob } from '../core/tenancy-context/storefront-public-stats.job';
import { TenantSignupService } from '../modules/tenancy/services/tenant-signup.service';
import { decodeKeyset, UUID_RE } from '../shared/pagination/us-keyset';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const JUNAGADH = '11111111-0000-7000-8000-000000000101';
const errCode = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string; message?: string }) => {
  const m = /\[([A-Z_]+)\]/.exec(String(e?.message ?? ''));
  return m ? m[1] : (e?.code ?? String(e));
});

run('PC-56 STORE-1b · storefront home & tenant home (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let kvApp: Pool; let cache: CacheService;
  const LIVE = randomUUID(); const TRIAL = randomUUID(); const UNVERIFIED = randomUUID(); const SUSP = randomUUID(); const EMPTY = randomUUID();
  let liveSlug = ''; let trialSlug = ''; let emptySlug = '';
  let seller = ''; let trialAdmin = ''; let catId = '';
  const feed: string[] = [];                 // LIVE's cross_tenant published listing ids, newest first
  const absent: Record<string, string> = {}; // listings that must NOT be in the feed
  const slugOf = async (id: string) => (await admin.query(`SELECT slug FROM tenants WHERE id = $1`, [id])).rows[0].slug as string;
  const flagKeys = ['flag:storefront_trial_visible', 'flags:all', 'flagstale:storefront_trial_visible'];

  async function asKvApp<T>(tenantId: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await kvApp.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId ?? '']);
      const out = await fn(c); await c.query('ROLLBACK'); return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }
  // The shared fixtures makeCategory / makeProduct bind one parameter as two types ("inconsistent types deduced" on PostgreSQL 16 —
  // a pre-existing helper defect, named in the wave report, not widened here), so this spec writes its own rows with explicit casts.
  let productId = '';
  async function listing(tenantId: string, o: { visibility: string; status?: string; createdAt?: string; title?: string }): Promise<string> {
    const r = await admin.query(
      `INSERT INTO listings (tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, min_order_qty, unit_code,
                             price_minor, currency_code, status, visibility, region_id, created_at)
       VALUES ($1, $2, $3, $4, $5::text, 40, 40, 1, 'quintal', 615000, 'INR', $6::listing_status, $7::text, $8, COALESCE($9::timestamptz, now()))
       RETURNING id`,
      [tenantId, seller, productId, catId, o.title ?? 'Lot', o.status ?? 'published', o.visibility, JUNAGADH, o.createdAt ?? null]);
    return r.rows[0].id;
  }
  async function role(userId: string, tenantId: string, code: string): Promise<void> {
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, tenantId, code]);
  }

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '100'; process.env.OTP_VERIFY_MAX_PER_HOUR = '100';
    admin = new Pool({ connectionString: ADMIN_URL });
    kvApp = new Pool({ connectionString: APP_URL, max: 3 });
    await makeTenant(admin, LIVE, 'Anand FPO 1b'); await makeTenant(admin, TRIAL, 'Trial FPO 1b'); await makeTenant(admin, UNVERIFIED, 'Unverified FPO 1b');
    await makeTenant(admin, SUSP, 'Paused FPO 1b'); await makeTenant(admin, EMPTY, 'Empty FPO 1b');
    await admin.query(`UPDATE tenants SET approved_at = now(), region_id = $2, created_at = '2024-03-01T00:00:00Z' WHERE id = $1`, [LIVE, JUNAGADH]);
    await admin.query(`UPDATE tenants SET approved_at = now() WHERE id = ANY($1::uuid[])`, [[EMPTY, SUSP]]);
    await admin.query(`UPDATE tenants SET status = 'trial' WHERE id = $1`, [TRIAL]);
    await admin.query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [SUSP]);
    liveSlug = await slugOf(LIVE); trialSlug = await slugOf(TRIAL); emptySlug = await slugOf(EMPTY);
    seller = await makeUser(admin); trialAdmin = await makeUser(admin);
    await role(trialAdmin, TRIAL, 'tenant_admin');
    // three member FARMERS (+ one staff member who is not one)
    for (const code of ['farmer', 'dairy_farmer', 'pashupalak']) await role(await makeUser(admin), LIVE, code);
    await role(seller, LIVE, 'farmer');   // the seller is a member farmer too → 4
    await role(await makeUser(admin), LIVE, 'tenant_staff');
    const code = 'c1b' + randomUUID().replace(/-/g, '').slice(0, 12);
    catId = (await admin.query(`INSERT INTO categories (code, default_name, path, depth, is_active) VALUES ($1::text, 'Grains 1b', $1::text::ltree, 1, true) RETURNING id`, [code])).rows[0].id;
    await admin.query(`INSERT INTO units (code, default_name, unit_class, is_active) VALUES ('quintal', 'Quintal', 'mass', true) ON CONFLICT (code) DO NOTHING`);
    productId = (await admin.query(`INSERT INTO products (category_id, default_name, default_unit, is_active) VALUES ($1, 'Groundnut 1b', 'quintal', true) RETURNING id`, [catId])).rows[0].id;
    // five cross_tenant listings in the SAME millisecond, distinct microseconds (the keyset's hard case), far enough ahead to sort first
    for (let i = 5; i >= 1; i--) feed.push(await listing(LIVE, { visibility: 'cross_tenant', createdAt: `2030-01-01T00:00:00.12300${i}Z`, title: `Groundnut lot ${i}` }));
    absent.publicOnly = await listing(LIVE, { visibility: 'public', title: 'Public wheat' });
    absent.membersOnly = await listing(LIVE, { visibility: 'tenant', title: 'Members wheat' });
    absent.draft = await listing(LIVE, { visibility: 'cross_tenant', status: 'draft', createdAt: '2030-01-01T00:00:01Z', title: 'Draft wheat' });
    absent.trial = await listing(TRIAL, { visibility: 'cross_tenant', createdAt: '2030-01-01T00:00:02Z', title: 'Trial wheat' });
    absent.suspendedTenant = await listing(SUSP, { visibility: 'cross_tenant', createdAt: '2030-01-01T00:00:03Z', title: 'Paused wheat' });
    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
  }, 180_000);
  afterAll(async () => {
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await kvApp?.end(); await admin?.end();
  }, 30_000);

  describe('D4 · a TRIAL organisation is invisible to anonymous callers', () => {
    it('anonymous + trial slug → 404 TENANT_NOT_FOUND on storefront/tenant, storefront/branding and the listing feed (a live slug answers)', async () => {
      for (const path of ['/v1/storefront/tenant', '/v1/storefront/branding', '/v1/listings', '/v1/storefront/profile']) {
        const r = await request(http).get(path).set('x-tenant-slug', trialSlug);
        expect([path, r.status, r.body.error?.code]).toEqual([path, 404, 'TENANT_NOT_FOUND']);
      }
      const byId = await request(http).get('/v1/storefront/branding').set('x-tenant-id', TRIAL);
      expect([byId.status, byId.body.error?.code]).toEqual([404, 'TENANT_NOT_FOUND']);
      expect((await request(http).get('/v1/storefront/tenant').set('x-tenant-slug', liveSlug)).status).toBe(200);
    });

    it('the trial tenant\'s own admin (a JWT) still reads its storefront and its feed', async () => {
      const token = mintToken(app, { userId: trialAdmin, tenantId: TRIAL, roles: ['tenant_admin'], perms: [] });
      const t = await request(http).get('/v1/storefront/tenant').set({ authorization: `Bearer ${token}`, 'x-tenant-slug': trialSlug });
      expect(t.status).toBe(200);
      expect(t.body.data.tenantId).toBe(TRIAL);
      const l = await request(http).get('/v1/listings').set({ authorization: `Bearer ${token}`, 'x-tenant-id': TRIAL });
      expect(l.status).toBe(200);
    });

    it('a bearer that did not verify + a trial header: NO tenant context (public read sees none; a protected route is 401, not 404)', async () => {
      const b = await request(http).get('/v1/storefront/branding').set({ authorization: 'Bearer not.a.jwt', 'x-tenant-id': TRIAL });
      expect(b.status).toBe(200);
      expect(b.body.data).toBeNull();
      const cart = await request(http).get('/v1/cart').set({ authorization: 'Bearer not.a.jwt', 'x-tenant-id': TRIAL });
      expect(cart.status).toBe(401);
    });

    it('kill-switch storefront_trial_visible ON (demo mode) → the trial store answers anonymously; OFF again → 404', async () => {
      expect((await admin.query(`SELECT is_enabled FROM feature_flags WHERE key = 'storefront_trial_visible'`)).rows[0].is_enabled).toBe(false);
      await admin.query(`UPDATE feature_flags SET is_enabled = true WHERE key = 'storefront_trial_visible'`);
      for (const k of flagKeys) await cache.del(k);
      try {
        const r = await request(http).get('/v1/storefront/tenant').set('x-tenant-slug', trialSlug);
        expect(r.status).toBe(200);
        expect(r.body.data.tenantId).toBe(TRIAL);
      } finally {
        await admin.query(`UPDATE feature_flags SET is_enabled = false WHERE key = 'storefront_trial_visible'`);
        for (const k of flagKeys) await cache.del(k);
      }
      expect((await request(http).get('/v1/storefront/tenant').set('x-tenant-slug', trialSlug)).status).toBe(404);
    });
  });

  describe('A3 · reserved slugs', () => {
    const orgType = async () => (await admin.query(`SELECT id FROM lookup_values WHERE type_code='tenant_type' AND code='fpo' AND tenant_id IS NULL ORDER BY created_at LIMIT 1`)).rows[0].id as string;
    const phone = () => `+9196${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

    it('signup skips a reserved name ("Cart" → cart-2 or later); a name only the DATABASE reserves → SIGNUP_SLUG_RESERVED, nothing created', async () => {
      const signup = app.get(TenantSignupService); const otp = app.get<OtpService>(OTP_SERVICE);
      const p1 = phone(); const { code: c1 } = await otp.issue(p1);
      const r = await signup.signUp({ phone: p1, code: c1, fullName: 'Cart Owner', orgName: 'Cart', orgTypeId: await orgType() }, null);
      expect(r.slug).toMatch(/^cart-/);
      // the admin realm reserves a new name the code list has never heard of — the trigger is the wall, the service names it
      const name = `res${randomUUID().replace(/-/g, '').slice(0, 10)}`;
      await admin.query(`INSERT INTO reserved_tenant_slugs (slug, reason) VALUES ($1, 'store1b test')`, [name]);
      const p2 = phone(); const { code: c2 } = await otp.issue(p2);
      const e = await signup.signUp({ phone: p2, code: c2, fullName: 'Reserved Owner', orgName: name, orgTypeId: await orgType() }, null).then(() => null, (x) => x);
      expect(e).toMatchObject({ code: 'SIGNUP_SLUG_RESERVED', httpStatus: 409 });
      expect((await admin.query(`SELECT count(*)::int n FROM tenants WHERE slug = $1`, [name])).rows[0].n).toBe(0);
      expect((await admin.query(`SELECT count(*)::int n FROM users WHERE phone = $1`, [p2])).rows[0].n).toBe(0);   // the whole transaction rolled back
    });

    it('a raw kv_app INSERT with slug `login` is refused by the trigger; an owner UPDATE of a slug to `login` too; kv_app holds no UPDATE on slug', async () => {
      const X = randomUUID();
      const ins = await errCode(asKvApp(X, (c) => c.query(
        `INSERT INTO tenants (id, slug, legal_name, display_name, tenant_type_id, country_code, status) SELECT $1, 'login', 'X', 'X', lv.id, 'IN', 'trial' FROM lookup_values lv WHERE lv.type_code='tenant_type' AND lv.code='fpo' AND lv.tenant_id IS NULL ORDER BY lv.created_at LIMIT 1`, [X])));
      expect(ins).toBe('TENANT_SLUG_RESERVED');
      expect(await errCode(admin.query(`UPDATE tenants SET slug = 'login' WHERE id = $1`, [EMPTY]))).toBe('TENANT_SLUG_RESERVED');
      expect(await errCode(admin.query(`UPDATE tenants SET slug = 'Cart' WHERE id = $1`, [EMPTY]))).toBe('TENANT_SLUG_RESERVED');   // case-folded
      // the brief's "raw kv_app UPDATE of tenants.slug": 0200 never granted kv_app UPDATE on slug, so it is refused BEFORE the trigger
      expect(await errCode(asKvApp(EMPTY, (c) => c.query(`UPDATE tenants SET slug = 'login' WHERE id = $1`, [EMPTY])))).toBe('42501');
      expect(await errCode(admin.query(`UPDATE tenants SET slug = $2 WHERE id = $1`, [EMPTY, emptySlug]))).toBe('ok');   // a non-reserved slug still moves
    });
  });

  describe('A1 · the public tenant profile', () => {
    it('returns ONLY the approved columns for a live tenant; nothing for a trial or suspended one', async () => {
      const cols = await asKvApp(null, async (c) => (await c.query(`SELECT * FROM public_tenant_profile($1::uuid)`, [LIVE])).fields.map((f) => f.name));
      expect(cols).toEqual(['display_name', 'legal_name', 'verified', 'since_year', 'district_name', 'member_count', 'logo_url', 'brand_version', 'currency_code']);
      for (const id of [TRIAL, SUSP, randomUUID()]) {
        expect(await asKvApp(null, async (c) => (await c.query(`SELECT * FROM public_tenant_profile($1::uuid)`, [id])).rowCount)).toBe(0);
      }
      expect(await asKvApp(null, async (c) => (await c.query(`SELECT count(*)::int n FROM tenants`)).rows[0].n)).toBe(0);   // the wall still stands
    });

    it('GET /v1/storefront/profile: verified (approved_at), since 2024, Junagadh, 4 member farmers (staff not counted), currency, no PII', async () => {
      const r = await request(http).get('/v1/storefront/profile').set('x-tenant-slug', liveSlug);
      expect(r.status).toBe(200);
      expect(r.body.data).toEqual({ displayName: 'Anand FPO 1b', legalName: 'Anand FPO 1b', verified: true, sinceYear: 2024, district: 'Junagadh',
        memberFarmers: 4, logoUrl: null, logoPath: null, currencyCode: 'INR' });
      expect(JSON.stringify(r.body.data)).not.toMatch(/owner|phone|gstin|pan"|cin|email|risk/i);
      const unverified = await request(http).get('/v1/storefront/profile').set('x-tenant-slug', await slugOf(UNVERIFIED));
      expect(unverified.body.data.verified).toBe(false);
    });
  });

  describe('A5 · the discovery feed and the directory', () => {
    it('only cross_tenant PUBLISHED listings of LIVE tenants, organisation named, no seller; µs keyset: 3 pages, no row twice', async () => {
      const seen: string[] = []; let after: string | null = null; let pages = 0;
      do {
        const r: request.Response = await request(http).get('/v1/storefront/discover').query({ limit: 2, ...(after ? { after } : {}) });
        expect(r.status).toBe(200);
        pages++;
        for (const c of r.body.data) {
          expect(Object.keys(c).sort()).toEqual(['currencyCode', 'district', 'grade', 'listingId', 'organic', 'organisation', 'priceMinor', 'tenantSlug', 'title', 'unitCode']);
          seen.push(c.listingId);
          if (feed.includes(c.listingId)) expect(c).toMatchObject({ tenantSlug: liveSlug, organisation: 'Anand FPO 1b', district: 'Junagadh', currencyCode: 'INR' });
        }
        after = r.body.meta.nextCursor;
        if (after) expect(decodeKeyset(after, UUID_RE)?.ts).toMatch(/\.\d{6}Z$/);
      } while (after && pages < 10);
      const mine = seen.filter((id) => feed.includes(id));
      expect(mine).toEqual(feed);                          // newest first, every one, in order
      expect(new Set(seen).size).toBe(seen.length);        // no row twice
      expect(pages).toBeGreaterThanOrEqual(3);
      for (const [why, id] of Object.entries(absent)) expect([why, seen.includes(id)]).toEqual([why, false]);
      const body = JSON.stringify(seen);
      expect(body).not.toContain(seller);
    });

    it('the category filter (the home\'s category strip) and a title prefix narrow the feed', async () => {
      const byCat = await request(http).get('/v1/storefront/discover').query({ category: catId, limit: 20 });
      expect(byCat.body.data.map((c: { listingId: string }) => c.listingId)).toEqual(feed);
      const byPrefix = await request(http).get('/v1/storefront/discover').query({ q: 'groundnut lot 3', limit: 20 });
      expect(byPrefix.body.data.map((c: { listingId: string }) => c.listingId)).toEqual([feed[2]]);
    });

    it('the directory: VERIFIED live organisations only (unverified, trial, suspended absent), keyset by one', async () => {
      const seen: string[] = []; let after: string | null = null; let guard = 0;
      do {
        const r: request.Response = await request(http).get('/v1/storefront/organisations').query({ limit: 1, ...(after ? { after } : {}) });
        expect(r.status).toBe(200);
        for (const o of r.body.data) {
          expect(Object.keys(o).sort()).toEqual(['displayName', 'district', 'logoPath', 'logoUrl', 'memberFarmers', 'slug']);
          seen.push(o.slug);
        }
        after = r.body.meta.nextCursor;
      } while (after && ++guard < 200);
      expect(seen).toContain(liveSlug); expect(seen).toContain(emptySlug);
      expect(seen).not.toContain(trialSlug); expect(seen).not.toContain(await slugOf(UNVERIFIED)); expect(seen).not.toContain(await slugOf(SUSP));
      expect(new Set(seen).size).toBe(seen.length);
    });
  });

  describe('A4/B3 · the precomputed stats', () => {
    it('the job is registered; its refresh then the read: counts equal a hand query and computedAt is set', async () => {
      expect(app.get(ScheduledJobRegistry).list().map((j) => j.name)).toContain('storefront-public-stats');
      const at = await app.get(StorefrontPublicStatsJob).refresh();
      const r = await request(http).get('/v1/storefront/stats');
      expect(r.status).toBe(200);
      const hand = (await admin.query(`
        SELECT (SELECT count(*) FROM listings l JOIN tenants t ON t.id = l.tenant_id AND t.status IN ('active','grace') AND t.deleted_at IS NULL
                 WHERE l.status = 'published' AND l.visibility IN ('public','cross_tenant') AND l.deleted_at IS NULL
                   AND NOT EXISTS (SELECT 1 FROM tenant_member_suspensions s WHERE s.tenant_id = l.tenant_id AND s.user_id = l.seller_user_id AND s.lifted_at IS NULL AND s.deleted_at IS NULL))::int AS listings,
               (SELECT count(*) FROM tenants WHERE status IN ('active','grace') AND deleted_at IS NULL AND approved_at IS NOT NULL)::int AS tenants,
               (SELECT count(DISTINCT region_id) FROM tenants WHERE status IN ('active','grace') AND deleted_at IS NULL AND approved_at IS NOT NULL AND region_id IS NOT NULL)::int AS districts`)).rows[0];
      expect(r.body.data).toEqual({ liveListings: hand.listings, verifiedOrganisations: hand.tenants, districts: hand.districts, computedAt: at });
      expect(r.body.data.liveListings).toBeGreaterThanOrEqual(6);   // LIVE's 5 cross_tenant + 1 public (the trial's / paused's / draft never)
      // kv_app cannot read or write the singleton itself — only through the two definer functions
      expect(await errCode(asKvApp(null, (c) => c.query(`SELECT * FROM platform_public_stats`)))).toBe('42501');
      expect(await errCode(asKvApp(null, (c) => c.query(`UPDATE platform_public_stats SET live_listings = 999999`)))).toBe('42501');
    });
  });

  describe('B2 · flags and the listing feed\'s counts', () => {
    // PC-56 STORE-1c (founder D1) added ONE platform switch to the allow-list (`org_self_signup`) and changed the no-tenant answer from a
    // 404 to the platform-scoped keys only — store1c-signup.integration.spec.ts (6) pins that half; this test keeps the tenant half.
    it('GET /v1/storefront/flags → { group_lots: boolean, org_self_signup } and nothing else; no tenant → no group_lots', async () => {
      const r = await request(http).get('/v1/storefront/flags').set('x-tenant-slug', liveSlug);
      expect(r.status).toBe(200);
      // PC-56 HOTFIX-4 · A8: + online_payments, buyer_charges, offers, auctions, reviews (tenant-scoped booleans)
      // PC-56 STORE-2a: + storefront_browse (platform-scoped, 0207)
      // PC-56 STORE-2b: + storefront_cart (platform-scoped, 0208)
      expect(Object.keys(r.body.data).sort()).toEqual(['auctions', 'buyer_charges', 'group_lots', 'offers', 'online_payments', 'org_self_signup', 'reviews', 'storefront_browse', 'storefront_cart']);
      expect(typeof r.body.data.group_lots).toBe('boolean');
      expect(JSON.stringify(r.body)).not.toMatch(/rollout|tenant_ids|rules|pct/);
      const platform = await request(http).get('/v1/storefront/flags');
      expect(platform.status).toBe(200);
      expect(platform.body.data).not.toHaveProperty('group_lots');
    });

    // PC-56 STORE-2a · B1 changed the filtered half ON PURPOSE: the total is now the count UNDER the filter (it was null whenever one narrowed)
    it('the tenant feed carries the capped total (public + cross_tenant published) and the members-only count; a filter is COUNTED under it (STORE-2a)', async () => {
      const r = await request(http).get('/v1/listings').set('x-tenant-slug', liveSlug);
      expect(r.status).toBe(200);
      expect(r.body.meta).toMatchObject({ total: 6, totalCap: 1000, membersOnlyCount: 1 });
      const filtered = await request(http).get('/v1/listings').query({ q: 'wheat' }).set('x-tenant-slug', liveSlug);
      expect(filtered.body.meta.total).toBe(1);   // "Public wheat" only — the members-only and the draft wheat are not public
      const empty = await request(http).get('/v1/listings').set('x-tenant-slug', emptySlug);
      expect(empty.body.meta).toMatchObject({ total: 0, membersOnlyCount: 0 });
    });

    it('the cap is a LIMIT, not a full count: public_tenant_listing_count(LIVE, 2) answers 3 = "more than 2" (parameterised cap)', async () => {
      expect(await asKvApp(null, async (c) => (await c.query(`SELECT public_tenant_listing_count($1::uuid, 2) AS n`, [LIVE])).rows[0].n)).toBe(3);
      expect(await asKvApp(null, async (c) => (await c.query(`SELECT public_tenant_listing_count($1::uuid, 100) AS n`, [LIVE])).rows[0].n)).toBe(6);
      expect(await asKvApp(null, async (c) => (await c.query(`SELECT public_tenant_members_only_count($1::uuid) AS n`, [LIVE])).rows[0].n)).toBe(1);
    });
  });
});
