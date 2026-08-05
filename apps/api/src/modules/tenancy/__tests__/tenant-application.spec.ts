// PC-55 A1 · public tenant-application DTO contract. The public door is the ONE anonymous write in the
// platform, so its validation IS the security boundary: strict keys (no mass-assignment), an org type that
// must be REAL or honestly free-text, phone shape, unicode org/pitch (Rule Zero: never block a language).
import { CreateTenantApplicationSchema } from '../dto/create-tenant-application.dto';

const ok = { orgName: 'Anand FPO', orgTypeOther: 'FPO', contactName: 'S Patel', contactPhone: '+919800000001' };

describe('CreateTenantApplicationSchema', () => {
  it('accepts a minimal honest application and defaults country/regions/docs', () => {
    const r = CreateTenantApplicationSchema.parse(ok);
    expect(r.countryCode).toBe('IN');
    expect(r.regionIds).toEqual([]);
    expect(r.docMediaIds).toEqual([]);
  });
  it('requires an org type — seeded id OR honest free-text (never neither)', () => {
    expect(() => CreateTenantApplicationSchema.parse({ ...ok, orgTypeOther: undefined })).toThrow();
    expect(CreateTenantApplicationSchema.parse({ ...ok, orgTypeOther: undefined, orgTypeId: '00000000-0000-7000-8000-000000000001' }).orgTypeId).toBeDefined();
  });
  it('rejects unknown keys (no mass-assignment through the public door)', () => {
    expect(() => CreateTenantApplicationSchema.parse({ ...ok, status: 'approved' })).toThrow();
    expect(() => CreateTenantApplicationSchema.parse({ ...ok, provisionedTenantId: '00000000-0000-7000-8000-000000000001' })).toThrow();
  });
  it('validates the phone shape and upper-cases any country (global from day one)', () => {
    expect(() => CreateTenantApplicationSchema.parse({ ...ok, contactPhone: '12' })).toThrow();
    expect(CreateTenantApplicationSchema.parse({ ...ok, countryCode: 'bd' }).countryCode).toBe('BD');
  });
  it('accepts non-Latin org names and pitches (Rule Zero: blocks no language)', () => {
    const r = CreateTenantApplicationSchema.parse({ ...ok, orgName: 'આનંદ ખેડૂત ઉત્પાદક કંપની', pitchText: 'हम ५०० किसानों के साथ काम करते हैं।' });
    expect(r.orgName).toContain('આનંદ');
    expect(r.pitchText).toContain('किसानों');
  });
});
