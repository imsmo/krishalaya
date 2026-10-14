// @krishalaya/sdk-js · PC-56 STORE-2a — the shapes the anonymous storefront's browse, search, listing, organisation and inputs pages stand on,
// pinned with an injected fake fetch (no network): `listings.search` sends the new grammar (grade · organic split · category subtree ·
// district · sort + cursor) ANONYMOUSLY and returns the capped count + facets; the public row has no seller / region uuid; the tombstone has
// no price; the attributes, the regulated marker and the organisation page each hit their own route; the flags carry storefront_browse.
import { createClient } from '../client';
import type { ListingSearchPage, ListingTombstone, OrganisationPage, PublicListingCard, RegulatedMarker, StorefrontFlags, PublicListingDetail } from '../types';

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
const client = (fn: typeof fetch) => createClient({ baseUrl: 'https://api.test', getToken: () => 'tok', tenantSlug: 'anand-fpo', fetchImpl: fn });

const CARD: PublicListingCard = { id: 'l1', title: 'GG-20', priceMinor: '615000', currencyCode: 'INR', unitCode: 'quintal', quantityAvailable: 34,
  organicClaim: true, organic: 'natural', saleType: 'direct', status: 'published', boosted: false, grade: 'Grade A', district: 'Junagadh',
  organisation: { slug: 'anand-fpo', name: 'Anand FPO' }, licenceRequired: false };

describe('PC-56 STORE-2a · SDK', () => {
  it('listings.search: the new grammar, anonymous, and the page carries the capped count + facets', async () => {
    const facets = { grade: [{ id: 'g1', name: 'Grade A', count: 2 }], ungraded: 1, organic: { certified: 0, natural: 2, none: 1 }, district: [{ id: 'd1', name: 'Junagadh', count: 3 }], saleType: [{ id: 'direct', count: 3 }] };
    const { fn, calls } = fakeFetch(() => ({ body: { data: [CARD], meta: { total: 3, totalCap: 1000, nextCursor: 'C2', membersOnlyCount: 0, facets } } }));
    const page: ListingSearchPage = await client(fn).listings.search({ grade: 'g1', organic: 'natural', category: 'c1', district: 'd1', sort: 'price_asc', cursor: 'C1', limit: 24 });
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe('/v1/listings');
    expect(Object.fromEntries(u.searchParams)).toEqual({ grade: 'g1', organic: 'natural', category: 'c1', district: 'd1', sort: 'price_asc', cursor: 'C1', limit: '24' });
    expect(hdr(calls[0]).authorization ?? hdr(calls[0]).Authorization).toBeUndefined();   // anonymous: the public catalogue
    expect([page.total, page.totalCap, page.nextCursor]).toEqual([3, 1000, 'C2']);
    expect(page.facets).toEqual(facets);
    expect(page.items[0]).not.toHaveProperty('sellerUserId');
    expect(page.items[0]).not.toHaveProperty('regionId');
  });

  it('a page above the cap carries facets: null (withheld)', async () => {
    const { fn } = fakeFetch(() => ({ body: { data: [], meta: { total: 1001, totalCap: 1000, nextCursor: null, facets: null } } }));
    expect((await client(fn).listings.search()).facets).toBeNull();
  });

  it('tombstone / attributes / regulated / organisationPage each read their own public route, anonymously', async () => {
    const tomb: ListingTombstone = { id: 'l1', tombstone: true, status: 'sold_out', title: 'GG-20', organisation: { slug: 'anand-fpo', name: 'Anand FPO' }, category: { id: 'c1', name: 'Groundnut' } };
    const marker: RegulatedMarker = { licenceRequired: true, licenceRequiredIn: [], bannedRegions: ['Kerala'], safetyLabel: null };
    const org: OrganisationPage = { profile: { displayName: 'Anand FPO', legalName: 'Anand FPC Ltd', verified: true, sinceYear: 2019, district: 'Anand', memberFarmers: 1240, currencyCode: 'INR' },
      listingCount: 38, listingCountCap: 1000, reviews: null };
    const { fn, calls } = fakeFetch((c) => {
      if (c.url.endsWith('/tombstone')) return { body: { data: tomb } };
      if (c.url.endsWith('/attributes')) return { body: { data: [{ code: 'moisture_pct', name: 'Moisture', kind: 'number', value: '7.8', unit: '%' }] } };
      if (c.url.endsWith('/regulated')) return { body: { data: marker } };
      return { body: { data: org } };
    });
    const api = client(fn).listings;
    const t = await api.tombstone('l1');
    expect(t).toEqual(tomb);
    expect(t).not.toHaveProperty('priceMinor');
    expect((await api.attributes('l1'))[0].value).toBe('7.8');
    expect((await api.regulated('l1')).licenceRequired).toBe(true);
    expect((await api.organisationPage()).reviews).toBeNull();
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/v1/listings/l1/tombstone', '/v1/listings/l1/attributes', '/v1/listings/l1/regulated', '/v1/sellers/organisation']);
    for (const c of calls) {
      expect(hdr(c).authorization ?? hdr(c).Authorization).toBeUndefined();
      expect(hdr(c)['X-Tenant-Slug'] ?? hdr(c)['x-tenant-slug']).toBe('anand-fpo');
    }
  });

  it('the public detail type carries quantityTotal, gradeConfirmed and attributes; the flags type carries storefront_browse', () => {
    const d: Pick<PublicListingDetail, 'quantityTotal' | 'gradeConfirmed' | 'attributes'> = { quantityTotal: 40, gradeConfirmed: { name: 'Grade A', gradedBy: 'Anand FPO' }, attributes: [] };
    const f: StorefrontFlags = { org_self_signup: true, storefront_browse: false };
    expect([d.quantityTotal, d.gradeConfirmed?.gradedBy, f.storefront_browse]).toEqual([40, 'Anand FPO', false]);
  });
});
