// Unit tests for the PURE worker My-Documents logic (features/labour/worker-documents) behind screen 139. Verifies
// the catalogue-joined checklist (real names + masked values), bank/UPI resolution, and computed completion.
import { checklistRows, bankAccount, upiAccount, documentsProgress } from '../../features/labour/worker-documents';
import type { KycDocument, KycDocType, BankAccount } from '@krishalaya/sdk-js';

const DT: KycDocType[] = [
  { id: 't-aadhaar', code: 'aadhaar', name: 'Aadhaar Card' },
  { id: 't-pan', code: 'pan', name: 'PAN Card' },
  { id: 't-photo', code: 'photo', name: 'Profile Photo' },
];
const KYC: KycDocument[] = [
  { id: 'k1', status: 'verified', docTypeId: 't-aadhaar', docNoMasked: 'XXXX XXXX 4521' },
  { id: 'k2', status: 'verified', docTypeId: 't-photo' },
];
const BANKS: BankAccount[] = [
  { id: 'b1', accountKind: 'bank', accountLast4: '8921', ifsc: 'BARB0ANAND', holderName: 'x', isPrimary: true },
];

describe('checklistRows', () => {
  it('joins catalogue → submitted doc; masked value + status; present flag', () => {
    const rows = checklistRows(DT, KYC);
    expect(rows[0]).toMatchObject({ code: 'aadhaar', name: 'Aadhaar Card', docNoMasked: 'XXXX XXXX 4521', status: 'verified', present: true });
    expect(rows[1]).toMatchObject({ code: 'pan', present: false, status: null, docNoMasked: null });
    expect(rows[2]).toMatchObject({ code: 'photo', present: true });
  });
  it('is empty for no catalogue', () => { expect(checklistRows([], KYC)).toEqual([]); });
});

describe('bankAccount / upiAccount', () => {
  it('finds the primary bank, and null UPI when none', () => {
    expect(bankAccount(BANKS)?.id).toBe('b1');
    expect(upiAccount(BANKS)).toBeNull();
  });
  it('finds a UPI when present', () => {
    expect(upiAccount([...BANKS, { id: 'u1', accountKind: 'upi', upiId: 'x@ybl', isPrimary: false }])?.upiId).toBe('x@ybl');
  });
});

describe('documentsProgress', () => {
  it('counts submitted identity docs + bank + upi over catalogue+2', () => {
    // 2 of 3 identity present + bank(1) + upi(0) = 3 ; total = 3 + 2 = 5
    expect(documentsProgress(DT, KYC, BANKS)).toEqual({ done: 3, total: 5 });
  });
  it('reflects reality (nothing added)', () => {
    expect(documentsProgress(DT, [], [])).toEqual({ done: 0, total: 5 });
  });
});
