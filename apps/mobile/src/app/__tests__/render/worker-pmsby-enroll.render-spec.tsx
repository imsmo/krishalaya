// apps/mobile/src/app/__tests__/render/worker-pmsby-enroll.render-spec.tsx · DEV-24 render-floor test for
// src/app/(worker)/pmsby-enroll.tsx (screen 145) after wiring the REAL enrolment+premium-payment endpoints
// (DEV-22/23). `worker_app` defaults OFF, unmocked here (real flag store) — the screen must take its flag-gated
// EmptyState branch before ever loading eligibility data or calling the new insurance API. The flag-ON
// enrolment-flow render is covered separately in worker-pmsby-enroll-on.render-spec.tsx.
import React from 'react';
import { EmptyState } from '@krishi-verse/ui-native';
import { renderScreen } from '../../../test-utils/render';
import PmsbyEnroll from '../../(worker)/pmsby-enroll';

const mockGetMyWorker = jest.fn(async () => null);
const mockMyBankAccounts = jest.fn(async () => []);
const mockKycDocTypes = jest.fn(async () => []);
const mockMyDocuments = jest.fn(async () => []);
const mockFindPmsbyProduct = jest.fn(async () => null);
const mockProposePmsbyPolicy = jest.fn();
const mockPayPmsbyPremium = jest.fn();

jest.mock('../../../features/labour/labour.api', () => ({ getMyWorker: () => mockGetMyWorker() }));
jest.mock('../../../features/kyc/kyc.api', () => ({ myDocuments: () => mockMyDocuments(), kycDocTypes: () => mockKycDocTypes() }));
jest.mock('../../../features/profile/profile.api', () => ({ myBankAccounts: () => mockMyBankAccounts() }));
jest.mock('../../../features/insurance/insurance.api', () => ({
  findPmsbyProduct: () => mockFindPmsbyProduct(),
  proposePmsbyPolicy: (input: unknown) => mockProposePmsbyPolicy(input),
  payPmsbyPremium: (id: string) => mockPayPmsbyPremium(id),
}));

describe('(worker)/pmsby-enroll — render floor', () => {
  it('renders without throwing and honors the flag-OFF EmptyState (worker_app defaults OFF)', async () => {
    const renderer = await renderScreen(<PmsbyEnroll />);
    const empty = renderer.root.findByType(EmptyState);
    expect(empty.props.title).toBeTruthy();
    expect(mockFindPmsbyProduct).not.toHaveBeenCalled();
    expect(mockProposePmsbyPolicy).not.toHaveBeenCalled();
  });
});
