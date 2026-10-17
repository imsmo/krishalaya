// modules/listings/__tests__/store5b-organic-claim.spec.ts · PC-56 STORE-5b · D1 / B18 — the badge rule's two halves: the pure public value and
// the ONE SQL fragment (its conditions pinned by text — the live spec proves them against the database).
import { publicOrganic, organicWire } from '../domain/organic-claim';
import { CERTIFIED_SQL, COVERED_SQL } from '../read-models/certified.sql';
import { toPublicListing } from '../domain/listing-public.view';

describe('STORE-5b · publicOrganic', () => {
  it('certified only while covered; a certified claim without a certificate is self_declared; natural stays natural; none is none', () => {
    expect(publicOrganic('certified', true)).toBe('certified');
    expect(publicOrganic('certified', false)).toBe('self_declared');
    expect(publicOrganic('natural', true)).toBe('natural');
    expect(publicOrganic('none', true)).toBe('none');
    expect(publicOrganic(null, true)).toBe('none');
    expect(organicWire('none', false)).toBeNull();
    expect(organicWire('certified', false)).toBe('self_declared');
  });
  it('CERTIFIED_SQL: the claim AND a verified, organic (vocabulary meta), valid-today certificate of the same organisation covering the listing, the organisation or a trace lot\'s parcel', () => {
    const s = CERTIFIED_SQL('l');
    expect(s).toContain(`l.organic_claim = 'certified'`);
    expect(s).toContain(COVERED_SQL('l'));
    for (const frag of [`kvcert.status = 'verified'`, `(kvct.meta->>'organic') = 'true'`, `kvcert.valid_until >= CURRENT_DATE`, `kvcert.tenant_id = l.tenant_id`,
      `kvcert.subject_type = 'listing' AND kvcert.subject_id = l.id`, `kvcert.subject_type = 'tenant' AND kvcert.subject_id = l.tenant_id`, `kvtl.listing_id = l.id`]) {
      expect(s).toContain(frag);
    }
  });
  it('the public detail: a certified claim reads certified only when the facts say covered; otherwise self_declared (fail closed when facts are absent)', () => {
    const p = { id: 'x', title: 't', description: null, categoryId: 'c', productId: 'p', unitCode: 'kg', priceMinor: 1n, currencyCode: 'INR', quantityAvailable: 1, quantityTotal: 1,
      minOrderQty: 1, harvestDate: null, organicClaim: 'certified', saleType: 'direct', status: 'published', publishedAt: null } as never;
    expect(toPublicListing(p).organicClaim).toBe('self_declared');
    expect(toPublicListing(p, { organisation: null, district: null, grade: null, organicCovered: true }).organicClaim).toBe('certified');
    expect(toPublicListing({ ...(p as object), organicClaim: 'none' } as never).organicClaim).toBe('none');
  });
});
