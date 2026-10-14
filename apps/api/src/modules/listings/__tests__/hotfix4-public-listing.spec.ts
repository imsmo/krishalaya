// PC-56 HOTFIX-4 · A6 (survey F-7 / C-1, founder D3) — the PUBLIC listing is an ALLOW-LIST. A fixture carrying the farm's coordinates, its
// pincode, the region uuid, the tenant id, the version, the AI flag, the seller's user id and the QC trail reaches the public view with
// NONE of them; the seller is named as the ORGANISATION; the place as a district NAME. The service's non-owner branch uses this view.
import { toPublicListing, PUBLIC_LISTING_KEYS, NO_PUBLIC_FACTS } from '../domain/listing-public.view';
import type { ListingProps } from '../domain/listing.entity';

// PC-56 STORE-2a · B2 moves ONE key out of this list ON PURPOSE: `quantityTotal` (canon W277 "Available 34 of 40 qtl" — the lot's size is
// a fact of the offer, not a private one). Every other key stays a leak.
const LEAKS = ['lat', 'lng', 'pincode', 'regionId', 'tenantId', 'version', 'aiExtracted', 'aiMeta', 'sellerUserId', 'visibility',
  'qcSubmittedAt', 'qcReviewedBy', 'qcReviewedAt', 'rejectReason', 'createdBy', 'expiresAt', 'publishAt'];

const props = (over: Partial<ListingProps> = {}): ListingProps => ({
  id: 'L1', tenantId: 'T1', sellerUserId: 'U-farmer', productId: 'P1', categoryId: 'C1', title: 'Bold groundnut', description: 'Moisture 7.8%',
  quantityTotal: 40, quantityAvailable: 34, minOrderQty: 5, unitCode: 'quintal', priceMinor: 615000n, currencyCode: 'INR',
  organicClaim: 'natural', status: 'published', saleType: 'direct', pincode: '362001', regionId: 'R-uuid', lat: 21.522222, lng: 70.457777,
  visibility: 'public', aiExtracted: true, publishAt: null, publishedAt: new Date('2026-07-08T10:00:00Z'), expiresAt: new Date('2026-08-08T10:00:00Z'),
  version: 7, qcSubmittedAt: new Date(), qcReviewedBy: 'staff-1', qcReviewedAt: new Date(), rejectReason: null, createdBy: 'staff-2',
  harvestDate: '2026-07-08', ...over,
});

describe('HOTFIX-4 · A6 toPublicListing — an allow-list, never the entity minus a few keys', () => {
  it('carries EXACTLY the allow-listed keys', () => {
    const v = toPublicListing(props(), { organisation: { slug: 'anand-fpo', name: 'Anand FPO' }, district: 'Junagadh', grade: 'Grade A' });
    expect(Object.keys(v).sort()).toEqual([...PUBLIC_LISTING_KEYS].sort());
  });
  it.each(LEAKS)('never carries %s (coordinates, ids, version, AI flags, the QC trail, the seller person)', (k) => {
    expect(toPublicListing(props())).not.toHaveProperty(k);
    expect(JSON.stringify(toPublicListing(props()))).not.toMatch(/21\.52|70\.45|362001|U-farmer|R-uuid/);
  });
  it('names the ORGANISATION and a district NAME (D3); money as a minor-unit string + its currency', () => {
    const v = toPublicListing(props(), { organisation: { slug: 'anand-fpo', name: 'Anand FPO' }, district: 'Junagadh', grade: 'Grade A' });
    expect(v.organisation).toEqual({ slug: 'anand-fpo', name: 'Anand FPO' });
    expect(v.district).toBe('Junagadh');
    expect(v.grade).toBe('Grade A');
    expect([v.priceMinor, v.currencyCode]).toEqual(['615000', 'INR']);
    expect([v.minOrderQty, v.quantityAvailable, v.harvestDate, v.publishedAt]).toEqual([5, 34, '2026-07-08', '2026-07-08T10:00:00.000Z']);
  });
  it("organic is a boolean of the CLAIM ('none' is not organic — the old read sent the string and the page badged it)", () => {
    expect(toPublicListing(props({ organicClaim: 'none' })).organic).toBe(false);
    expect(toPublicListing(props({ organicClaim: 'certified' })).organic).toBe(true);
  });
  it('no facts → null organisation / district / grade (never a guess), still no leaked key', () => {
    const v = toPublicListing(props(), NO_PUBLIC_FACTS);
    expect([v.organisation, v.district, v.grade]).toEqual([null, null, null]);
    for (const k of LEAKS) expect(v).not.toHaveProperty(k);
  });
});
