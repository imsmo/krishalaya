// apps/web-storefront/src/test/public-listing-view.spec.ts · PC-56 HOTFIX-4 · A6/C5 (survey F-7, founder D3) — the listing page's view model
// names each field it uses. A payload that (wrongly) still carried the farm's coordinates, pincode, region id, tenant id, version, AI flag or
// the seller's user id could not get any of them onto the page: the SDK type does not have them, and this function does not read them.
import type { PublicListingDetail } from '@krishalaya/sdk-js';
import { publicListingView } from '../features/listing/public-view';

const DETAIL: PublicListingDetail = {
  id: 'L1', title: 'Bold groundnut', description: 'Moisture 7.8%', categoryId: 'c', productId: 'p', grade: 'Grade A', unitCode: 'quintal',
  priceMinor: '615000', currencyCode: 'INR', quantityAvailable: 34, minOrderQty: 5, harvestDate: '2026-07-08', organicClaim: 'none', organic: false,
  saleType: 'direct', status: 'published', district: 'Junagadh', organisation: { slug: 'anand-fpo', name: 'Anand FPO' }, publishedAt: null,
  qrToken: null, auctionId: null, auctionStatus: null, auctionEndsAt: null,
};
const LEAKY = { ...DETAIL, lat: 21.522222, lng: 70.457777, pincode: '362001', regionId: 'R-uuid', tenantId: 'T', version: 7, aiExtracted: true,
  sellerUserId: 'U-farmer', sellerName: 'Ramesh Patel' } as unknown as PublicListingDetail;

describe('HOTFIX-4 · public listing view', () => {
  it('a fixture carrying lat/lng/pincode/ids/the seller person: NONE of it reaches the view model', () => {
    const v = publicListingView(LEAKY);
    for (const k of ['lat', 'lng', 'pincode', 'regionId', 'tenantId', 'version', 'aiExtracted', 'sellerUserId', 'sellerName']) expect(v).not.toHaveProperty(k);
    expect(JSON.stringify(v)).not.toMatch(/21\.52|70\.45|362001|U-farmer|Ramesh/);
  });
  it('the seller is the ORGANISATION; the place a district name; organic is the claim\'s boolean (\'none\' is not organic)', () => {
    const v = publicListingView(DETAIL);
    expect([v.organisation, v.district, v.organic, v.grade, v.minOrderQty]).toEqual([{ slug: 'anand-fpo', name: 'Anand FPO' }, 'Junagadh', false, 'Grade A', 5]);
    expect(publicListingView({ ...DETAIL, organicClaim: 'certified', organic: true }).organic).toBe(true);
  });
  it('money stays a minor-unit string with its OWN currency', () => {
    const v = publicListingView({ ...DETAIL, priceMinor: '1500', currencyCode: 'JPY' });
    expect([v.priceMinor, v.currencyCode]).toEqual(['1500', 'JPY']);
  });
});
