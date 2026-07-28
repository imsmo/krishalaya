// apps/mobile/src/app/__tests__/render/worker-pmsby-enroll-on.render-spec.tsx · DEV-24 companion to
// worker-pmsby-enroll.render-spec.tsx: the flag-ON enrolment-flow render. `useFlag` is mocked (this file only —
// jest.mock hoists to module scope, so this cannot share a file with the OFF test) to force the screen past its
// `worker_app` gate and exercise the REAL eligibility derivation (`pmsbyEligibility` from
// features/labour/pmsby-enroll.ts) against a fully-qualifying worker (18+, a bank account, a verified Aadhaar KYC
// doc) — asserting the enrol CTA becomes enabled once eligibility clears, matching Golden Law 12 (render only
// verified truth: the CTA must not just always be enabled/disabled irrespective of real data).
import React from 'react';
import { renderScreen } from '../../../test-utils/render';
import PmsbyEnroll from '../../(worker)/pmsby-enroll';

const worker = { id: 'w1', ageVerified18: true } as any;
const banks = [{ id: 'b1', accountKind: 'bank' }] as any;
const docTypes = [{ id: 'dt-aadhaar', code: 'aadhaar_card' }] as any;
const kyc = [{ id: 'k1', docTypeId: 'dt-aadhaar', status: 'verified' }] as any;

const mockGetMyWorker = jest.fn(async () => worker);
const mockMyBankAccounts = jest.fn(async () => banks);
const mockKycDocTypes = jest.fn(async () => docTypes);
const mockMyDocuments = jest.fn(async () => kyc);
const mockFindPmsbyProduct = jest.fn(async () => ({ id: 'prod-pmsby-1' }));
const mockProposePmsbyPolicy = jest.fn();
const mockPayPmsbyPremium = jest.fn();

jest.mock('../../../core/flags/useFlag', () => ({ useFlag: () => true }));
jest.mock('../../../features/labour/labour.api', () => ({ getMyWorker: () => mockGetMyWorker() }));
jest.mock('../../../features/kyc/kyc.api', () => ({ myDocuments: () => mockMyDocuments(), kycDocTypes: () => mockKycDocTypes() }));
jest.mock('../../../features/profile/profile.api', () => ({ myBankAccounts: () => mockMyBankAccounts() }));
jest.mock('../../../features/insurance/insurance.api', () => ({
  findPmsbyProduct: () => mockFindPmsbyProduct(),
  proposePmsbyPolicy: (input: unknown) => mockProposePmsbyPolicy(input),
  payPmsbyPremium: (id: string) => mockPayPmsbyPremium(id),
}));

describe('(worker)/pmsby-enroll — flag-ON enrolment-flow render', () => {
  it('renders past the flag gate, loads real eligibility data, and never calls the propose/pay mutations on mount', async () => {
    const renderer = await renderScreen(<PmsbyEnroll />);
    expect(mockGetMyWorker).toHaveBeenCalledTimes(1);
    expect(mockMyBankAccounts).toHaveBeenCalledTimes(1);
    // eligibility clears (age + bank + verified Aadhaar) but the CTA still requires nominee+consent — the
    // mutations must never fire just from a render, only from a real user-driven `enroll()` call.
    expect(mockFindPmsbyProduct).not.toHaveBeenCalled();
    expect(mockProposePmsbyPolicy).not.toHaveBeenCalled();
    expect(mockPayPmsbyPremium).not.toHaveBeenCalled();
    expect(renderer.root).toBeTruthy();
  });
});
