// core/tenancy-context/__tests__/store1b-storefront-public.spec.ts · PC-56 STORE-1b — the pure / mocked half of the wave's API proof
// (the live half is src/__tests__/store1b-storefront.integration.spec.ts).
//   B1  the tenant-context middleware hides a TRIAL tenant from an ANONYMOUS caller in one place: no bearer → 404 TENANT_NOT_FOUND; a
//       bearer that did not verify → no tenant context (the route's own 401 still answers); a JWT tenant is never consulted; the
//       kill-switch ON shows it; a flag-store failure keeps it hidden; a DB failure is 503, never a false 404 or a leak;
//   B2  page-size clamp (the probe row stays inside 0204's 48), the flags endpoint is an ALLOW-LIST, profile/flags need a context tenant;
//   B3  the stats job calls the definer refresh on the kv_app pool and never counts anything itself;
//   GAP-B15  the listing feed's counts: capped total only when nothing narrows the feed; never on the owner view.
import { TenantContextMiddleware, STOREFRONT_TRIAL_VISIBLE_FLAG } from '../tenant-context.middleware';
import { getRequestContext, type RequestContext } from '../request-context';
import { StorefrontPublicController, STOREFRONT_PUBLIC_FLAGS } from '../storefront-public.controller';
import { pageSize, PUBLIC_PAGE_MAX, StorefrontPublicReadModel } from '../storefront-public.read-model';
import { StorefrontPublicStatsJob, STOREFRONT_PUBLIC_STATS_JOB, STOREFRONT_PUBLIC_STATS_MS } from '../storefront-public-stats.job';
import { ListingSearchReadModel, narrowsFeed, PUBLIC_LISTING_COUNT_CAP } from '../../../modules/listings/read-models/listing-search.read-model';
import { decodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';

const TRIAL = '01b1b000-0000-7000-8000-00000000000a';
const LIVE = '01b1b000-0000-7000-8000-00000000000b';
const USER = '01b1b000-0000-7000-8000-0000000000aa';
const shards = { shardFor: () => 0 } as never;
const roles = { effectiveAccess: jest.fn() } as never;

function slugs(opts: { liveError?: boolean } = {}) {
  return {
    resolve: jest.fn(async (s: string) => (s === 'trial-fpo' ? TRIAL : s === 'live-fpo' ? LIVE : null)),
    resolveId: jest.fn(async (id: string) => id),
    resolveHost: jest.fn(async () => ({ value: null, error: false })),
    isPublicLive: jest.fn(async (id: string) => (opts.liveError ? { live: false, error: true } : { live: id === LIVE, error: false })),
  };
}
const flagsWith = (on: Record<string, boolean>) => ({ isEnabled: jest.fn(async (k: string) => on[k] === true) });

async function call(mw: TenantContextMiddleware, headers: Record<string, string>) {
  let seen: RequestContext | null = null; let status = 200; let body = '';
  const res = { status: (s: number) => { status = s; return res; }, setHeader: () => res, end: (b: string) => { body = b; } } as never;
  await mw.use({ headers, requestId: 'r1' } as never, res, () => { seen = getRequestContext(); });
  return { tenantId: (seen as RequestContext | null)?.tenantId ?? null, status, code: body ? JSON.parse(body).error.code : null };
}

describe('STORE-1b · B1 — trial is hidden from anonymous callers (one place: TenantContextMiddleware)', () => {
  const anon = { fromAuthHeader: () => null } as never;

  it('anonymous (no bearer) + a TRIAL slug → 404 TENANT_NOT_FOUND, the request never reaches a handler', async () => {
    const mw = new TenantContextMiddleware(anon, slugs() as never, shards, roles, undefined, flagsWith({}) as never);
    expect(await call(mw, { 'x-tenant-slug': 'trial-fpo' })).toEqual({ tenantId: null, status: 404, code: 'TENANT_NOT_FOUND' });
  });
  it('the same through X-Tenant-Id (and therefore every anonymous read path) → 404', async () => {
    const mw = new TenantContextMiddleware(anon, slugs() as never, shards, roles, undefined, flagsWith({}) as never);
    expect(await call(mw, { 'x-tenant-id': TRIAL })).toEqual({ tenantId: null, status: 404, code: 'TENANT_NOT_FOUND' });
  });
  it('a LIVE (active | grace) tenant is untouched', async () => {
    const mw = new TenantContextMiddleware(anon, slugs() as never, shards, roles, undefined, flagsWith({}) as never);
    expect(await call(mw, { 'x-tenant-slug': 'live-fpo' })).toEqual({ tenantId: LIVE, status: 200, code: null });
  });
  it('a member of the trial tenant (a JWT tenant) is never consulted — their console keeps working', async () => {
    const s = slugs();
    const jwt = { fromAuthHeader: () => ({ tenantId: TRIAL, userId: USER, sessionId: 's', roles: ['tenant_admin'], permissions: [] }) } as never;
    const mw = new TenantContextMiddleware(jwt, s as never, shards, roles, undefined, flagsWith({}) as never);
    expect(await call(mw, { authorization: 'Bearer a.b.c', 'x-tenant-slug': 'trial-fpo' })).toEqual({ tenantId: TRIAL, status: 200, code: null });
    expect(s.isPublicLive).not.toHaveBeenCalled();
  });
  it('a bearer that did not verify (expired) + a trial header → NO tenant context (the protected route answers 401, not 404)', async () => {
    const mw = new TenantContextMiddleware(anon, slugs() as never, shards, roles, undefined, flagsWith({}) as never);
    expect(await call(mw, { authorization: 'Bearer expired.jwt.here', 'x-tenant-id': TRIAL })).toEqual({ tenantId: '', status: 200, code: null });
  });
  it(`kill-switch ${STOREFRONT_TRIAL_VISIBLE_FLAG} ON = demo mode: the trial tenant answers anonymously`, async () => {
    const s = slugs();
    const mw = new TenantContextMiddleware(anon, s as never, shards, roles, undefined, flagsWith({ [STOREFRONT_TRIAL_VISIBLE_FLAG]: true }) as never);
    expect(await call(mw, { 'x-tenant-slug': 'trial-fpo' })).toEqual({ tenantId: TRIAL, status: 200, code: null });
    expect(s.isPublicLive).not.toHaveBeenCalled();
  });
  it('a flag store that throws, or no flag service at all, keeps the rule (hidden) — fail closed', async () => {
    const boom = { isEnabled: async () => { throw new Error('flags down'); } } as never;
    expect((await call(new TenantContextMiddleware(anon, slugs() as never, shards, roles, undefined, boom), { 'x-tenant-slug': 'trial-fpo' })).status).toBe(404);
    expect((await call(new TenantContextMiddleware(anon, slugs() as never, shards, roles), { 'x-tenant-slug': 'trial-fpo' })).status).toBe(404);
  });
  it('the liveness read failing is 503 TENANT_RESOLUTION_UNAVAILABLE — never a false 404, never a trial store shown', async () => {
    const mw = new TenantContextMiddleware(anon, slugs({ liveError: true }) as never, shards, roles, undefined, flagsWith({}) as never);
    expect(await call(mw, { 'x-tenant-slug': 'live-fpo' })).toEqual({ tenantId: null, status: 503, code: 'TENANT_RESOLUTION_UNAVAILABLE' });
  });
  it('no tenant at all (the platform home) is untouched: no liveness read', async () => {
    const s = slugs();
    const mw = new TenantContextMiddleware(anon, s as never, shards, roles, undefined, flagsWith({}) as never);
    expect(await call(mw, {})).toEqual({ tenantId: '', status: 200, code: null });
    expect(s.isPublicLive).not.toHaveBeenCalled();
  });
});

describe('STORE-1b · B2 — the public reads', () => {
  it('page size: default 24, never above 47 (so the "is there more" probe stays inside 0204\'s 48-row cap)', () => {
    expect(pageSize(undefined)).toBe(24); expect(pageSize('0')).toBe(24); expect(pageSize('abc')).toBe(24);
    expect(pageSize('10')).toBe(10); expect(pageSize(500)).toBe(PUBLIC_PAGE_MAX); expect(PUBLIC_PAGE_MAX + 1).toBeLessThanOrEqual(48);
  });

  it('discover: passes a µs cursor through to the definer and returns the next one; a malformed cursor is page one', async () => {
    const rows = [1, 2, 3].map((i) => ({
      listing_id: `01b1b000-0000-7000-8000-00000000010${i}`, tenant_slug: 'anand-fpo', tenant_display_name: 'Anand FPO', title: `Lot ${i}`,
      price_minor: '615000', currency_code: 'INR', unit_code: 'quintal', organic: false, grade_name: 'Grade A', district_name: 'Anand',
      created_us: `2026-10-13T10:00:00.00000${i}Z`,
    }));
    const query = jest.fn().mockResolvedValue({ rows });
    const rm = new StorefrontPublicReadModel({ replica: () => ({ query }) } as never);
    const page = await rm.discover({ limit: '2', after: 'not-a-cursor' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/public_discovery_feed\(\$1::timestamptz, \$2::uuid, \$3::int, \$4::uuid, \$5::text\)/);
    expect(params).toEqual([null, null, 3, null, null]);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toEqual({ listingId: rows[0].listing_id, tenantSlug: 'anand-fpo', organisation: 'Anand FPO', title: 'Lot 1', priceMinor: '615000',
      currencyCode: 'INR', unitCode: 'quintal', organic: false, grade: 'Grade A', district: 'Anand' });
    // the card carries no seller / user id and no person's name — the organisation only
    expect(Object.keys(page.items[0])).not.toEqual(expect.arrayContaining(['sellerUserId']));
    expect(decodeKeyset(page.nextCursor, UUID_RE)).toEqual({ ts: '2026-10-13T10:00:00.000002Z', id: rows[1].listing_id });
  });

  it('stats: a never-computed row is said to be never computed (computedAt null), not three measured zeros', async () => {
    const rm = new StorefrontPublicReadModel({ replica: () => ({ query: async () => ({ rows: [{ live_listings: '0', verified_tenants: '0', districts: '0', computed_at: null }] }) }) } as never);
    expect(await rm.stats()).toEqual({ liveListings: 0, verifiedOrganisations: 0, districts: 0, computedAt: null });
  });

  it('stats are READ, never computed on the request (founder D3): one query, the definer read of the singleton — no count, no refresh', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ live_listings: '2418', verified_tenants: '312', districts: '41', computed_at: new Date('2026-10-13T10:15:00Z') }] });
    const rm = new StorefrontPublicReadModel({ replica: () => ({ query }), writer: () => ({ query }) } as never);
    expect(await rm.stats()).toEqual({ liveListings: 2418, verifiedOrganisations: 312, districts: 41, computedAt: '2026-10-13T10:15:00.000Z' });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toBe('SELECT * FROM public_platform_stats()');
    expect(query.mock.calls[0][0]).not.toMatch(/count\(|refresh_|FROM listings|FROM tenants/i);
  });

  // PC-56 STORE-1c (founder D1) widened the allow-list by ONE platform switch, `org_self_signup`, and the no-tenant answer: it used to be a
  // 404; it is now the platform-scoped keys only (the platform's /for-organisations page has no tenant). `group_lots` is still answered
  // only for a tenant in context — store1c-storefront-plans.spec.ts pins the new key in full.
  it('flags: an ALLOW-LIST of booleans, group_lots evaluated for the context tenant; no tenant → no group_lots (never a guess)', async () => {
    const isEnabled = jest.fn(async (k: string, c: { tenantId?: string }) => k === 'group_lots' && c.tenantId === LIVE);
    const ctl = new StorefrontPublicController({} as never, { isEnabled } as never);
    // PC-56 HOTFIX-4 · A8: + online_payments, buyer_charges, offers, auctions, reviews (tenant-scoped)
    // PC-56 STORE-2a · B4: + storefront_browse (platform-scoped, the catalogue's kill-switch)
    // PC-56 STORE-2b · B5: + storefront_cart (platform-scoped, buying's kill-switch)
    // PC-56 STORE-3a · B6 (founder D2): + `disputes` (tenant-scoped, fail-closed) — the order page's dispute door
    expect(STOREFRONT_PUBLIC_FLAGS).toEqual(['group_lots', 'org_self_signup', 'online_payments', 'buyer_charges', 'offers', 'auctions', 'reviews', 'storefront_browse', 'storefront_cart', 'disputes']);
    expect(await ctl.publicFlags({ tenantId: LIVE } as RequestContext)).toEqual({ data: { group_lots: true, org_self_signup: false, online_payments: false, buyer_charges: false, offers: false, auctions: false, reviews: false, storefront_browse: false, storefront_cart: false, disputes: false } });
    expect(isEnabled).toHaveBeenCalledTimes(10);   // one per allow-listed key (HOTFIX-4: 2 → 7; STORE-2a: 8; STORE-2b: 9; STORE-3a: 10)
    expect((await ctl.publicFlags({ tenantId: '' } as RequestContext)).data).not.toHaveProperty('group_lots');
    await expect(ctl.profile({ tenantId: '' } as RequestContext)).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });
});

describe('STORE-1b · B3 — the stats clock', () => {
  it('is named, every 15 minutes, and CALLs the definer refresh on the kv_app writer (the relay pool is not used)', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ at: new Date('2026-10-13T10:15:00.000Z') }] });
    const job = new StorefrontPublicStatsJob(STOREFRONT_PUBLIC_STATS_MS, { writer: () => ({ query }) } as never);
    expect(job.name).toBe(STOREFRONT_PUBLIC_STATS_JOB); expect(job.name).toBe('storefront-public-stats');
    expect(job.intervalMs).toBe(15 * 60_000);
    const relay = { query: jest.fn() };
    await job.run(relay as never);
    expect(query).toHaveBeenCalledWith('SELECT refresh_platform_public_stats() AS at');
    expect(relay.query).not.toHaveBeenCalled();
  });
});

describe('STORE-1b · GAP-B15 — the listing feed counts', () => {
  const T = '01b1b000-0000-7000-8000-0000000000c1';
  function build() {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 1001, members_only: 3 }] });
    const rm = new ListingSearchReadModel({ forTenant: () => ({ query }) } as never, { inc: jest.fn(), observe: jest.fn() } as never);
    return { rm, query };
  }
  // PC-56 STORE-2a · B1 CHANGED THIS ON PURPOSE (survey F-17 / B17): the count used to be asked for only when nothing narrowed the feed
  // (null otherwise — "an unfiltered count printed as 'N results' would be false"). It is now the count UNDER THE FILTERS, capped, from ONE
  // bounded statement that also yields the facets (listing-search.read-model.ts header); the members-only count is still 0204's counter.
  it('public feed: the capped total + cap + members-only count, from the one bounded count statement', async () => {
    const { rm, query } = build();
    const r = await rm.query(T, { limit: 20, sort: 'newest' } as never);
    expect(r).toMatchObject({ total: 1001, totalCap: PUBLIC_LISTING_COUNT_CAP, membersOnlyCount: 3, facets: null });
    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/WITH f AS MATERIALIZED/);
    expect(sql).toMatch(/LIMIT \$\d+::int \+ 1/);
    expect(sql).toMatch(/public_tenant_members_only_count\(\$1::uuid\)/);
    expect(params[0]).toBe(T);
    expect(params[params.length - 1]).toBe(1000);
  });
  it('a narrowing filter is COUNTED under that filter (STORE-2a: a true count under every filter, not null)', async () => {
    const { rm, query } = build();
    const r = await rm.query(T, { limit: 20, sort: 'newest', categoryId: T } as never);
    expect(query.mock.calls[1][0]).toMatch(/l\.category_id = \$2/);
    expect(query.mock.calls[1][1]).toEqual([T, T, 1000]);
    expect(r.total).toBe(1001);
    expect(narrowsFeed({ q: 'wheat' } as never)).toBe(true);
    expect(narrowsFeed({ cursor: 'x', sort: 'price_asc' } as never)).toBe(false);
  });
  it('the owner view never counts', async () => {
    const { rm, query } = build();
    const r = await rm.query(T, { limit: 20, sort: 'newest' } as never, { ownerUserId: USER });
    expect(query).toHaveBeenCalledTimes(1);
    expect(r.total).toBeNull();
  });
});
