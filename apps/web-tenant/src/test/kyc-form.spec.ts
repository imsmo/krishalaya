import { buildKycSubmission, isMaskedDocNo } from '../features/kyc/form';

describe('features/kyc/form', () => {
  const base = { docTypeId: 'dt-1', mediaId: 'm-1', docNoMasked: '' };

  it('accepts a valid submission without a doc number', () => {
    const r = buildKycSubmission(base);
    expect(r).toEqual({ ok: true, value: { docTypeId: 'dt-1', mediaId: 'm-1' } });
  });

  it('accepts a properly masked doc number and trims fields', () => {
    const r = buildKycSubmission({ docTypeId: ' dt-1 ', mediaId: ' m-1 ', docNoMasked: ' XXXX-XXXX-1234 ' });
    expect(r).toEqual({ ok: true, value: { docTypeId: 'dt-1', mediaId: 'm-1', docNoMasked: 'XXXX-XXXX-1234' } });
  });

  it('rejects a missing doc type', () => {
    expect(buildKycSubmission({ ...base, docTypeId: '  ' })).toEqual({ ok: false, error: 'doctype' });
  });

  it('rejects a missing media id (photo is mandatory)', () => {
    expect(buildKycSubmission({ ...base, mediaId: '' })).toEqual({ ok: false, error: 'docmedia' });
  });

  it('rejects a raw-looking doc number (privacy law: never transport >4 plain digits)', () => {
    expect(buildKycSubmission({ ...base, docNoMasked: '1234 5678 9012' })).toEqual({ ok: false, error: 'docno' });
    expect(isMaskedDocNo('ABCDE1234F')).toBe(false); // PAN letters not in masked alphabet
    expect(isMaskedDocNo('999999999999')).toBe(false);
  });

  it('masked alphabet allows X/x/*/space/hyphen/slash and ≤4 digits, ≤32 chars', () => {
    expect(isMaskedDocNo('XXXX-XXXX-1234')).toBe(true);
    expect(isMaskedDocNo('**** **** 9012')).toBe(true);
    expect(isMaskedDocNo('xx/xx/1234')).toBe(true);
    expect(isMaskedDocNo('X'.repeat(33))).toBe(false);
  });
});
