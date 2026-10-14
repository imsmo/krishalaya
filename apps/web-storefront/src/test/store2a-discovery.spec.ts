// apps/web-storefront/src/test/store2a-discovery.spec.ts · PC-56 STORE-2a — the PURE half of browse / search / the lot / the organisation /
// inputs: the URL grammar (legacy spellings read the same; a bad value is dropped, never trusted), the cursor ↔ sort coupling (every link but
// "Show more" drops the cursor; "Show more" keeps the sort it was minted under), the remove-one chips, the facet mapping (withheld above the
// cap), the category trail, the inputs roots (by commerce kind, not by code), the read outcome with the kill-switch kept apart, the lot's facts
// (confirmed grade only), the buyer panel's flags, the tombstone (no price), the decimal quantity (string math), and the refusal map.
import type { ListingTombstone, StorefrontFlags } from '@krishalaya/sdk-js';
import {
  activeChips, browseHref, browseOff, categoryTrail, countOf, facetView, inputsRoots, isFiltered, readBrowse, readState, showMoreHref, toSearchQuery,
} from '../features/store2a/browse';
import { buyerPanel, dayAsDate, lotFacts, parseQuantity, tombstoneView } from '../features/store2a/listing';
import { publicListingView } from '../features/listing/public-view';
import { STORE2A_CHAIN_PAGES, STORE2A_DELTAS, STORE2A_REFUSALS, store2aRefusalKeys } from '../features/store2/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const U = (n: number) => `0207a000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const node = (id: string, parentId: string | null, name: string, kind = 'goods') =>
  ({ id, parentId, code: name.toLowerCase(), defaultName: name, path: name.toLowerCase(), depth: 1, commerceKind: kind, requiresLicense: false, requiresCertificate: false, minAge: null, isActive: true, sortOrder: 1 });

describe('STORE-2a · the browse URL grammar', () => {
  it('reads the state; legacy categoryId and organic=1 read the same; a non-uuid id, an unknown sort or a bad price is DROPPED', () => {
    expect(readBrowse({ q: ' groundnut ', categoryId: U(1), organic: '1', grade: 'none', sort: 'price_asc', priceMin: '6000.5' }))
      .toEqual({ q: 'groundnut', category: U(1), organic: 'any', grade: 'none', sort: 'price_asc', priceMin: '6000.5' });
    expect(readBrowse({ category: 'crops', district: '../x', grade: 'A', sort: 'distance', priceMax: '6e3', organic: 'maybe', saleType: 'barter' })).toEqual({});
  });
  it('the SDK query: the price band in the STORE currency\'s exponent; an unknown currency drops the band, never guesses', () => {
    expect(toSearchQuery({ priceMin: '1500' }, 0)).toMatchObject({ priceMinMinor: '1500' });
    expect(toSearchQuery({ priceMin: '1500' }, 2)).toMatchObject({ priceMinMinor: '150000' });
    expect(toSearchQuery({ priceMin: '1500' }, null).priceMinMinor).toBeUndefined();
    expect(toSearchQuery({ grade: U(2), organic: 'certified', district: U(3), sort: 'price_desc', cursor: 'C' }, 2))
      .toMatchObject({ grade: U(2), organic: 'certified', district: U(3), sort: 'price_desc', cursor: 'C', limit: 24 });
  });
  it('CURSOR ↔ SORT: every filter / sort link drops the cursor; "Show more" keeps the sort and sets the new cursor', () => {
    const s = readBrowse({ sort: 'price_asc', cursor: 'OLD', grade: U(2) });
    expect(browseHref('/s', s, { district: U(3) })).toBe(`/s?district=${U(3)}&grade=${U(2)}&sort=price_asc`);
    expect(browseHref('/s', s, { sort: 'newest' })).toBe(`/s?grade=${U(2)}&sort=newest`);
    expect(browseHref('/s', s, {})).not.toContain('cursor');
    expect(showMoreHref('/s', s, 'NEXT')).toBe(`/s?grade=${U(2)}&sort=price_asc&cursor=NEXT`);
    expect(isFiltered({ sort: 'price_asc', cursor: 'x' })).toBe(false);
    expect(isFiltered({ grade: 'none' })).toBe(true);
  });
  it('chips: one remove-one link per active filter, the rest kept; an unnamed id still gets a chip', () => {
    const s = readBrowse({ grade: U(2), district: U(3), q: 'gg', sort: 'newest' });
    const chips = activeChips('/s', s, (k, v) => (k === 'grade' ? 'Grade A' : k === 'district' ? '?' : v));
    expect(chips.map((c) => [c.key, c.href])).toEqual([
      ['q', `/s?district=${U(3)}&grade=${U(2)}&sort=newest`],
      ['district', `/s?q=gg&grade=${U(2)}&sort=newest`],
      ['grade', `/s?q=gg&district=${U(3)}&sort=newest`],
    ]);
    expect(chips.find((c) => c.key === 'district')?.label).toBe('?');
  });
  it('facets: counts → links (toggle on/off), Not graded only when > 0, organic split, sale types known only; null → withheld', () => {
    const labels = { ungraded: 'Not graded', certified: 'Certified', natural: 'Natural', saleType: (id: string) => id.toUpperCase() };
    const f = { grade: [{ id: U(2), name: 'Grade A', count: 3 }], ungraded: 0, organic: { certified: 0, natural: 2, none: 1 },
      district: [{ id: U(3), name: 'Junagadh', count: 3 }], saleType: [{ id: 'direct', count: 3 }, { id: 'hacked', count: 1 }] };
    const v = facetView('/s', { grade: U(2) }, f, labels)!;
    expect(v.grade).toEqual([{ id: U(2), label: 'Grade A', count: 3, href: '/s', active: true }]);   // the active one toggles OFF
    expect(v.organic.map((o) => o.id)).toEqual(['natural']);
    expect(v.district[0].href).toBe(`/s?district=${U(3)}&grade=${U(2)}`);
    expect(v.saleType.map((x) => x.id)).toEqual(['direct']);
    expect(facetView('/s', {}, { ...f, ungraded: 4 }, labels)!.grade.map((g) => g.id)).toEqual([U(2), 'none']);
    expect(facetView('/s', {}, null, labels)).toBeNull();
  });
  it('the capped count: exact up to the cap, "cap+" above; nothing when the API did not say', () => {
    expect(countOf(126, 1000)).toEqual({ n: 126, capped: false });
    expect(countOf(1001, 1000)).toEqual({ n: 1000, capped: true });
    expect(countOf(null, 1000)).toBeNull();
  });
  it('the category trail root → leaf from the public tree; the inputs roots by commerce kind (data), never by code', () => {
    const tree = [node(U(1), null, 'Crops'), node(U(2), U(1), 'Oilseeds'), node(U(3), U(2), 'Groundnut'), node(U(4), null, 'Inputs', 'input_regulated'),
      { ...node(U(5), null, 'Pesticides', 'input_regulated'), isActive: false }, node(U(6), U(4), 'Seeds', 'input_regulated')];
    expect(categoryTrail(tree, U(3)).map((c) => c.name)).toEqual(['Crops', 'Oilseeds', 'Groundnut']);
    expect(categoryTrail(tree, 'unknown')).toEqual([]);
    expect(inputsRoots(tree).map((c) => c.id)).toEqual([U(4)]);
  });
  it('the read outcome keeps the kill-switch apart from an outage and a 404; a FAILED flags read is not "off"', async () => {
    const off = await readState(async () => { throw Object.assign(new Error('x'), { status: 503, code: 'STOREFRONT_BROWSE_OFF' }); });
    const down = await readState(async () => { throw Object.assign(new Error('x'), { status: 503, code: 'UNAVAILABLE' }); });
    const nf = await readState(async () => { throw Object.assign(new Error('x'), { status: 404 }); });
    expect([off, down, nf]).toEqual([{ ok: false, kind: 'browse_off' }, { ok: false, kind: 'unavailable' }, { ok: false, kind: 'not_found' }]);
    const flagsOn = { ok: true as const, data: { org_self_signup: true, storefront_browse: true } as StorefrontFlags };
    expect(browseOff(flagsOn)).toBe(false);
    expect(browseOff({ ok: true, data: { org_self_signup: true, storefront_browse: false } })).toBe(true);
    expect(browseOff({ ok: false, kind: 'unavailable' })).toBe(false);
    expect(browseOff(flagsOn, off)).toBe(true);
    expect(browseOff(flagsOn, down)).toBe(false);
  });
});

describe('STORE-2a · the lot', () => {
  const detail = {
    id: 'L1', title: 'GG-20', description: null, categoryId: 'c', productId: 'p', grade: 'Grade A', unitCode: 'quintal', priceMinor: '615000', currencyCode: 'INR',
    quantityAvailable: 34, quantityTotal: 40, minOrderQty: 5, harvestDate: '2026-07-08', organicClaim: 'certified' as const, organic: true, saleType: 'direct',
    status: 'published', district: 'Junagadh', organisation: { slug: 'anand-fpo', name: 'Anand FPO' }, publishedAt: null,
    gradeConfirmed: { name: 'Grade A', gradedBy: 'Anand FPO' }, attributes: [], qrToken: null, auctionId: null, auctionStatus: null, auctionEndsAt: null,
  };
  it('facts: the CONFIRMED grade only (no confirmation → no grade, even if a legacy `grade` arrives); the harvest DAY; traceable only with a token', () => {
    const f = lotFacts(publicListingView(detail));
    expect([f.grade, f.organic, f.harvestDay, f.traceable, f.available, f.total, f.minOrder]).toEqual([{ name: 'Grade A', gradedBy: 'Anand FPO' }, 'certified', '2026-07-08', false, 34, 40, 5]);
    const unconfirmed = lotFacts(publicListingView({ ...detail, gradeConfirmed: null }));
    expect(unconfirmed.grade).toBeNull();
    expect(publicListingView({ ...detail, gradeConfirmed: null }).grade).toBeNull();
    expect(dayAsDate('2026-07-08').toISOString()).toBe('2026-07-08T12:00:00.000Z');
  });
  it('the buyer panel: offers only with the offers flag; the auction only with auctions AND a linked auction; escrow only with online payments', () => {
    expect(buyerPanel(null, true)).toEqual({ offers: false, auction: false, escrow: false });
    expect(buyerPanel({ org_self_signup: true, offers: true, auctions: true, online_payments: true }, false)).toEqual({ offers: true, auction: false, escrow: true });
    expect(buyerPanel({ org_self_signup: true, auctions: true }, true).auction).toBe(true);
  });
  it('the tombstone view: status, title, organisation — NO price key; relist → the organisation\'s page; similar → the category', () => {
    const t: ListingTombstone = { id: 'L1', tombstone: true, status: 'paused', title: 'GG-20', organisation: { slug: 'anand-fpo', name: 'Anand FPO' }, category: { id: 'c1', name: 'Groundnut' } };
    const v = tombstoneView(t, 'anand-fpo');
    expect(v).toEqual({ status: 'paused', title: 'GG-20', organisation: 'Anand FPO', relistHref: '/anand-fpo/sellers', categoryHref: '/anand-fpo?category=c1' });
    expect(JSON.stringify(v)).not.toMatch(/price|Minor/i);
  });
  it('the quantity: a decimal STRING with ≤ 3 places, > 0, ≤ available — string math, never a float', () => {
    expect(parseQuantity('2.5', 34)).toBe('2.5');
    expect(parseQuantity('2.500', '34')).toBe('2.5');
    expect(parseQuantity('34', 34)).toBe('34');
    expect(parseQuantity('0.001', '0.001')).toBe('0.001');
    for (const bad of ['0', '0.000', '-1', '1.2345', '1e3', 'abc', '', '34.001']) expect([bad, parseQuantity(bad, 34)]).toEqual([bad, null]);
    expect(parseQuantity('0.3', '0.30000000000000004')).toBe('0.3');   // a float-ish available is cut to thousandths, not compared as a float
  });
});

describe('STORE-2a · the refusal map', () => {
  it('every refusal names its canon, its surfaces and a key present in all three catalogues; every English one says no', () => {
    expect(STORE2A_REFUSALS.length).toBe(25);
    for (const r of STORE2A_REFUSALS) {
      expect(r.surfaces.length).toBeGreaterThan(0);
      for (const cat of [en, hi, gu]) expect([r.key, typeof (cat as Record<string, string>)[r.key]]).toEqual([r.key, 'string']);
      expect([r.key, /\bnot\b|\bno\b|\bnever\b|nobody|nothing/i.test((en as Record<string, string>)[r.key])]).toEqual([r.key, true]);
    }
    expect(new Set(STORE2A_REFUSALS.map((r) => r.id)).size).toBe(STORE2A_REFUSALS.length);
  });
  it('each surface prints its own refusals (and the platform-wide switch sentence is on all five)', () => {
    for (const s of ['browse', 'search', 'listing', 'sellers', 'inputs'] as const) {
      expect(store2aRefusalKeys(s)).toContain('store2a.refusal.flagTenantPlan');
    }
    expect(store2aRefusalKeys('listing')).toEqual(expect.arrayContaining(['store2a.refusal.aiGrade', 'store2a.refusal.priceFee', 'store2a.refusal.dispatchRegrade', 'store2a.refusal.tellMeIfReturns', 'store2a.refusal.helpline']));
    expect(store2aRefusalKeys('inputs')).toEqual(expect.arrayContaining(['store2a.refusal.fifo', 'store2a.refusal.mrp', 'store2a.refusal.age', 'store2a.refusal.labelHelpline', 'store2a.refusal.inputsSwitch']));
  });
  it('the 12 chain pages are all recorded with their FLOWMAP citation; the DELTAs are recorded', () => {
    expect(STORE2A_CHAIN_PAGES.map((c) => c.file.slice(0, 5))).toEqual(['W3080', 'W3081', 'W3082', 'W3096', 'W3097', 'W3098', 'W3103', 'W3104', 'W3105', 'W3148', 'W3149', 'W3150']);
    for (const c of STORE2A_CHAIN_PAGES) { expect(c.flowmap.length).toBeGreaterThan(0); expect(c.verdict).toMatch(/PARITY-DECOR/); }
    expect(STORE2A_DELTAS.map((d) => d.id)).toEqual(expect.arrayContaining(['category_route', 'offset_pagination', 'per_farmer_page', 'confirm_before_filter', 'chain_back_links']));
  });
});
