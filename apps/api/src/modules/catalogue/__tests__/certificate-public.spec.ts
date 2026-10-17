// modules/catalogue/__tests__/certificate-public.spec.ts · PC-56 STORE-5b · D1 (founder Q7) — the public certificate, an allow-list: the role,
// never the person; the effective status; the rejection reason; the organic types from the vocabulary.
import { publicCertificate, effectiveStatus, isOrganicType } from '../domain/certificate-public';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ID = '0219c000-0000-7000-8000-0000000c0001';
// a row as a FUTURE definer might over-share it: owner, verifier, media ids — the allow-list must drop every one
const ROW = (over: Record<string, unknown> = {}) => ({
  id: ID, tenantId: '0219c000-0000-7000-8000-0000000000aa', organisation: { displayName: 'Anand FPO', slug: 'anand-fpo' },
  typeCode: 'lab_report', certNo: 'LAB-26-08841', issuingBody: 'Junagadh Agricultural University — Food Testing Lab',
  validFrom: '2026-06-06', validUntil: '2026-09-06', status: 'verified', expired: false, subjectType: 'listing', coversListing: 'GG-20 groundnut',
  verifiedAt: '2026-06-08T10:00:00+05:30', verifierRole: 'fpo_coordinator', rejectionReason: 'a stale note',
  verifiedBy: '0219c000-0000-7000-8000-00000000dead', ownerUserId: '0219c000-0000-7000-8000-00000000beef', mediaId: '0219c000-0000-7000-8000-00000000f11e',
  ...over,
});

describe('STORE-5b · publicCertificate', () => {
  it('the allow-list: the role (never the person), no owner / verifier / media uuid — the only uuid is the certificate id', () => {
    const c = publicCertificate(ROW());
    expect(c.checkedBy).toEqual({ organisation: 'Anand FPO', role: 'fpo_coordinator', at: '2026-06-08T10:00:00+05:30' });
    expect(Object.keys(c).sort()).toEqual(['certNo', 'checkedBy', 'coversListing', 'id', 'issuingBody', 'organisation', 'rejectionReason', 'status', 'subjectType', 'typeCode', 'validFrom', 'validUntil']);
    expect(JSON.stringify(c).match(UUID)).toEqual([ID]);
    expect(JSON.stringify(c)).not.toMatch(/platform|verifiedBy|ownerUserId|mediaId|tenantId/);
    expect(c.rejectionReason).toBeNull();   // a verified certificate carries no rejection reason
  });
  it('a rejected certificate shows its reason; a pending one has no "checked by"; a verified one past validity reads expired', () => {
    expect(publicCertificate(ROW({ status: 'rejected', rejectionReason: 'the lab could not confirm the number' }))).toMatchObject({ status: 'rejected', rejectionReason: 'the lab could not confirm the number' });
    expect(publicCertificate(ROW({ status: 'pending', verifierRole: null, verifiedAt: null })).checkedBy).toBeNull();
    expect(publicCertificate(ROW({ expired: true })).status).toBe('expired');
    expect(effectiveStatus('expired', false)).toBe('expired');
    expect(effectiveStatus('verified', false)).toBe('verified');
  });
  it('the covers line only for a listing subject; an unknown subject kind is null', () => {
    expect(publicCertificate(ROW({ subjectType: 'tenant', coversListing: 'x' })).coversListing).toBeNull();
    expect(publicCertificate(ROW({ subjectType: 'galaxy' })).subjectType).toBeNull();
  });
  it('isOrganicType reads the vocabulary\'s meta, never a list in code', () => {
    expect(isOrganicType({ organic: true })).toBe(true);
    expect(isOrganicType({ organic: false })).toBe(false);
    expect(isOrganicType({})).toBe(false);
    expect(isOrganicType(null)).toBe(false);
  });
});
