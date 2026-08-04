// Unit tests for the PURE KYC re-submission issue builder (features/kyc/issues, screen 175). No React/native deps.
import { buildKycIssues } from '../../features/kyc/issues';
import type { KycDocument, KycDocType } from '@krishalaya/sdk-js';

const types: KycDocType[] = [{ id: 'dt1', code: 'land_712', name: '7/12 Utara' }, { id: 'dt2', code: 'aadhaar', name: 'Aadhaar Card' }];
const doc = (o: Partial<KycDocument>): KycDocument => ({ id: 'x', status: 'pending', ...o } as KycDocument);

describe('buildKycIssues', () => {
  it('includes only rejected docs, with real reason + resolved type name', () => {
    const docs = [
      doc({ id: 'a', status: 'rejected', docTypeId: 'dt1', rejectReason: 'Survey number not readable.' }),
      doc({ id: 'b', status: 'verified', docTypeId: 'dt2' }),
      doc({ id: 'c', status: 'pending', docTypeId: 'dt2' }),
    ];
    expect(buildKycIssues(docs, types)).toEqual([
      { id: 'a', docTypeId: 'dt1', docTypeName: '7/12 Utara', reason: 'Survey number not readable.' },
    ]);
  });
  it('degrades type name to null when doc-type is unknown / missing, reason to null when absent', () => {
    const docs = [doc({ id: 'a', status: 'rejected', docTypeId: 'zzz' }), doc({ id: 'b', status: 'rejected' })];
    expect(buildKycIssues(docs, types)).toEqual([
      { id: 'a', docTypeId: 'zzz', docTypeName: null, reason: null },
      { id: 'b', docTypeId: null, docTypeName: null, reason: null },
    ]);
  });
  it('returns [] for no rejected docs / empty / null', () => {
    expect(buildKycIssues([doc({ status: 'verified' })], types)).toEqual([]);
    expect(buildKycIssues([], types)).toEqual([]);
    expect(buildKycIssues(null, null)).toEqual([]);
  });
});
