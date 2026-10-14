// apps/web-storefront/src/test-render/store2a-fixtures.ts · PC-56 STORE-2a — the shared world of the five STORE-2a render tests (not a test
// file: jest.render.config.js matches *.render.test.tsx only). Each test's jest.mock factories `require` THIS module, so the page under test
// and the test read the same mutable state `S`: what the (mocked) API answers, which read fails and how — a 404, an outage, or the
// catalogue's named kill-switch refusal (503 STOREFRONT_BROWSE_OFF).
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures stand in for SDK shapes */
export const T = '0207a000-0000-7000-8000-000000000001';
export const L1 = '0207a000-0000-7000-8000-0000000000a1';
export const fail = (status: number, code = 'X') => { throw Object.assign(new Error(code), { status, code }); };
export const OFF = Object.freeze({ off: true });
/** readable names for the fixture ids (the pages only accept uuids in the URL) */
export const ID = Object.freeze({ crops: '0207c000-0000-7000-8000-000000000001', oil: '0207c000-0000-7000-8000-000000000002', gnut: '0207c000-0000-7000-8000-000000000003',
  inputs: '0207c000-0000-7000-8000-000000000004', gradeA: '0207e000-0000-7000-8000-00000000000a', gradeB: '0207e000-0000-7000-8000-00000000000b',
  junagadh: '0207d000-0000-7000-8000-000000000001', rajkot: '0207d000-0000-7000-8000-000000000002' });

export const PROFILE = { displayName: 'Anand FPO', legalName: 'Anand Farmer Producer Company Ltd', verified: true, sinceYear: 2019, district: 'Anand',
  memberFarmers: 1240, logoUrl: null, logoPath: null, currencyCode: 'INR' };
export const CATS = [
  { id: '0207c000-0000-7000-8000-000000000001', parentId: null, code: 'crops', defaultName: 'Crops', path: 'crops', depth: 1, commerceKind: 'goods', requiresLicense: false, requiresCertificate: false, minAge: null, isActive: true, sortOrder: 1 },
  { id: '0207c000-0000-7000-8000-000000000002', parentId: '0207c000-0000-7000-8000-000000000001', code: 'crops.oilseeds', defaultName: 'Oilseeds', path: 'crops.oilseeds', depth: 2, commerceKind: 'goods', requiresLicense: false, requiresCertificate: false, minAge: null, isActive: true, sortOrder: 1 },
  { id: '0207c000-0000-7000-8000-000000000003', parentId: '0207c000-0000-7000-8000-000000000002', code: 'crops.oilseeds.groundnut', defaultName: 'Groundnut', path: 'crops.oilseeds.groundnut', depth: 3, commerceKind: 'goods', requiresLicense: false, requiresCertificate: false, minAge: null, isActive: true, sortOrder: 1 },
  { id: '0207c000-0000-7000-8000-000000000004', parentId: null, code: 'inputs', defaultName: 'Farm inputs', path: 'inputs', depth: 1, commerceKind: 'input_regulated', requiresLicense: true, requiresCertificate: false, minAge: null, isActive: true, sortOrder: 2 },
];
export const CARD = (i: number, over: Record<string, unknown> = {}) => ({
  id: `0207a000-0000-7000-8000-00000000020${i}`, title: `GG-20 Groundnut ${i}`, priceMinor: '615000', currencyCode: 'INR', unitCode: 'quintal',
  quantityAvailable: 34, organicClaim: true, organic: 'natural', saleType: 'direct', status: 'published', boosted: false,
  grade: 'Grade A', district: 'Junagadh', organisation: { slug: 'anand-fpo', name: 'Anand FPO' }, licenceRequired: false, ...over,
});
export const FACETS = {
  grade: [{ id: '0207e000-0000-7000-8000-00000000000a', name: 'Grade A', count: 74 }, { id: '0207e000-0000-7000-8000-00000000000b', name: 'Grade B', count: 41 }], ungraded: 11,
  organic: { certified: 9, natural: 38, none: 79 },
  district: [{ id: '0207d000-0000-7000-8000-000000000001', name: 'Junagadh', count: 52 }, { id: '0207d000-0000-7000-8000-000000000002', name: 'Rajkot', count: 31 }],
  saleType: [{ id: 'direct', count: 98 }, { id: 'auction', count: 17 }, { id: 'group_lot', count: 11 }],
};
export const PAGE = (over: Record<string, unknown> = {}) => ({ items: [CARD(1), CARD(2)], nextCursor: 'CUR2', total: 126, totalCap: 1000, membersOnlyCount: 0, facets: FACETS, ...over });
export const DETAIL = (over: Record<string, unknown> = {}) => ({
  id: L1, title: 'GG-20 Groundnut — 40 qtl lot', description: 'Bold kernels, sun-dried.', categoryId: '0207c000-0000-7000-8000-000000000003', productId: 'p1', grade: 'Grade A',
  unitCode: 'quintal', priceMinor: '615000', currencyCode: 'INR', quantityAvailable: 34, quantityTotal: 40, minOrderQty: 5, harvestDate: '2026-07-08',
  organicClaim: 'natural', organic: true, saleType: 'direct', status: 'published', district: 'Junagadh', organisation: { slug: 'anand-fpo', name: 'Anand FPO' },
  publishedAt: '2026-07-09T00:00:00Z', gradeConfirmed: { name: 'Grade A', gradedBy: 'Anand FPO' },
  attributes: [{ code: 'moisture_pct', name: 'Moisture', kind: 'number', value: '7.8', unit: '%' }, { code: 'sorted', name: 'Hand sorted', kind: 'bool', value: 'true', unit: null }],
  qrToken: 'qr-1', auctionId: null, auctionStatus: null, auctionEndsAt: null, ...over,
});

export const S: {
  lang: string; flags: any; search: any; seen: any[]; categories: any; profile: any; detail: any; tombstone: any; marker: any; org: any;
  discover: any; organisations: any; orgSeen: any[];
} = {} as any;
export function reset(): void {
  Object.assign(S, {
    lang: 'en', flags: { group_lots: true, org_self_signup: true, storefront_browse: true, offers: false, auctions: false, reviews: false, online_payments: false },
    search: PAGE(), seen: [], categories: CATS, profile: PROFILE, detail: DETAIL(), tombstone: null, marker: { licenceRequired: false, licenceRequiredIn: [], bannedRegions: [], safetyLabel: null },
    org: { profile: { displayName: 'Anand FPO', legalName: 'Anand FPC Ltd', verified: true, sinceYear: 2019, district: 'Anand', memberFarmers: 1240, currencyCode: 'INR' },
      listingCount: 38, listingCountCap: 1000, reviews: null },
    discover: { items: [{ listingId: L1, tenantSlug: 'anand-fpo', organisation: 'Anand FPO', title: 'Groundnut bold', priceMinor: '615000', currencyCode: 'INR', unitCode: 'quintal', organic: true, grade: 'Grade A', district: 'Junagadh' }], nextCursor: 'D2' },
    organisations: { items: [{ slug: 'anand-fpo', displayName: 'Anand FPO', district: 'Anand', logoUrl: null, logoPath: null, memberFarmers: 1240 }], nextCursor: null },
    orgSeen: [],
  });
}
/** A read that answers `v`: an Error → an outage (503); OFF → the named kill-switch refusal; a number → that HTTP status. */
const answer = (v: any) => {
  if (v === OFF) return fail(503, 'STOREFRONT_BROWSE_OFF');
  if (v instanceof Error) return fail(503, 'UNAVAILABLE');
  if (typeof v === 'number') return fail(v, v === 404 ? 'NOT_FOUND' : 'X');
  return v;
};
export function apiClient(): any {
  return {
    storefront: {
      flags: async () => answer(S.flags), discover: async () => answer(S.discover),
      organisations: async (q: unknown) => { S.orgSeen.push(q); return answer(S.organisations); },
    },
    listings: {
      search: async (q: unknown) => { S.seen.push(q); return answer(typeof S.search === 'function' ? S.search(q) : S.search); },
      getPublic: async () => answer(S.detail), tombstone: async () => answer(S.tombstone ?? 404), regulated: async () => answer(S.marker),
      organisationPage: async () => answer(S.org), media: async () => [],
    },
    lookups: { categories: async () => answer(S.categories), regions: async () => [] },
  };
}
