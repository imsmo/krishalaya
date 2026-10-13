// @krishalaya/sdk-js · PC-56 STORE-1b — the two homes' public reads, pinned with an injected fake fetch (no network):
//   storefront.profile / stats / discover / organisations / flags are anonymous GETs on the real routes (discover / organisations carry
//   the keyset cursor + limit and return the next cursor); the tenant slug rides X-Tenant-Slug; a 404 surfaces as SdkError TENANT_NOT_FOUND;
//   listings.browse carries the capped total, its cap and the members-only count.
import { createClient } from '../client';
import { SdkError } from '../errors';

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (call: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const fn = (async (url: unknown, init: unknown) => {
    const call = { url: String(url), init: (init ?? {}) as RequestInit }; calls.push(call);
    const r = handler(call);
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const hdr = (c: Call) => (c.init.headers ?? {}) as Record<string, string>;

describe('PC-56 STORE-1b · SDK storefront home reads', () => {
  it('profile(): anonymous GET storefront/profile with the tenant slug; no bearer even when a token exists', async () => {
    const data = { displayName: 'Anand FPO', legalName: 'Anand Farmer Producer Co', verified: true, sinceYear: 2019, district: 'Anand', memberFarmers: 1240, logoUrl: null, logoPath: null, currencyCode: 'INR' };
    const { fn, calls } = fakeFetch(() => ({ body: { data } }));
    const c = createClient({ baseUrl: 'https://api.test', tenantSlug: 'anand-fpo', getToken: () => 'tok', fetchImpl: fn });
    expect(await c.storefront.profile()).toEqual(data);
    expect(calls[0].url).toBe('https://api.test/v1/storefront/profile');
    expect(calls[0].init.method).toBe('GET');
    expect(hdr(calls[0])['x-tenant-slug']).toBe('anand-fpo');
    expect(hdr(calls[0]).authorization).toBeUndefined();
  });

  it('profile() for a trial / unknown organisation surfaces SdkError 404 TENANT_NOT_FOUND', async () => {
    const { fn } = fakeFetch(() => ({ status: 404, body: { error: { code: 'TENANT_NOT_FOUND', message: 'x', details: {} } } }));
    const e = await createClient({ baseUrl: 'https://api.test', tenantSlug: 'trial-fpo', fetchImpl: fn }).storefront.profile().catch((x) => x);
    expect(e).toBeInstanceOf(SdkError);
    expect(e).toMatchObject({ status: 404, code: 'TENANT_NOT_FOUND' });
  });

  it('stats(): the precomputed counts and computedAt (null = never computed)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { liveListings: 2418, verifiedOrganisations: 312, districts: 41, computedAt: null } } }));
    expect(await createClient({ baseUrl: 'https://api.test', fetchImpl: fn }).storefront.stats()).toEqual({ liveListings: 2418, verifiedOrganisations: 312, districts: 41, computedAt: null });
    expect(calls[0].url).toBe('https://api.test/v1/storefront/stats');
  });

  it('discover(): cursor, limit, category and q ride the query string; the next cursor comes back; nothing undefined is sent', async () => {
    const card = { listingId: 'l1', tenantSlug: 'anand-fpo', organisation: 'Anand FPO', title: 'Groundnut', priceMinor: '615000', currencyCode: 'INR', unitCode: 'quintal', organic: false, grade: 'Grade A', district: 'Junagadh' };
    const { fn, calls } = fakeFetch(() => ({ body: { data: [card], meta: { nextCursor: 'CUR2' } } }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn });
    const page = await c.storefront.discover({ after: 'CUR1', limit: 8, category: 'cat-1', q: 'gro' });
    expect(page).toEqual({ items: [card], nextCursor: 'CUR2' });
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe('/v1/storefront/discover');
    expect(Object.fromEntries(u.searchParams)).toEqual({ after: 'CUR1', limit: '8', category: 'cat-1', q: 'gro' });
    await c.storefront.discover();
    expect(new URL(calls[1].url).search).toBe('');
  });

  it('organisations(): keyset page of the directory', async () => {
    const org = { slug: 'anand-fpo', displayName: 'Anand FPO', district: 'Anand', logoUrl: null, logoPath: null, memberFarmers: 1240 };
    const { fn, calls } = fakeFetch(() => ({ body: { data: [org], meta: { nextCursor: null } } }));
    expect(await createClient({ baseUrl: 'https://api.test', fetchImpl: fn }).storefront.organisations({ limit: 24 })).toEqual({ items: [org], nextCursor: null });
    expect(calls[0].url).toBe('https://api.test/v1/storefront/organisations?limit=24');
  });

  it('flags(): the allow-listed booleans of the context tenant', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { group_lots: false } } }));
    expect(await createClient({ baseUrl: 'https://api.test', tenantSlug: 'anand-fpo', fetchImpl: fn }).storefront.flags()).toEqual({ group_lots: false });
    expect(calls[0].url).toBe('https://api.test/v1/storefront/flags');
  });

  it('listings.browse(): the capped total, its cap and the members-only count', async () => {
    const { fn } = fakeFetch(() => ({ body: { data: [], meta: { nextCursor: null, total: 1001, totalCap: 1000, membersOnlyCount: 3 } } }));
    const page = await createClient({ baseUrl: 'https://api.test', tenantSlug: 'anand-fpo', fetchImpl: fn }).listings.browse({});
    expect(page).toEqual({ items: [], nextCursor: null, total: 1001, totalCap: 1000, membersOnlyCount: 3 });
    const { fn: f2 } = fakeFetch(() => ({ body: { data: [], meta: { nextCursor: null, total: null } } }));
    expect(await createClient({ baseUrl: 'https://api.test', fetchImpl: f2 }).listings.browse({})).toEqual({ items: [], nextCursor: null, total: null, totalCap: null, membersOnlyCount: null });
  });
});
