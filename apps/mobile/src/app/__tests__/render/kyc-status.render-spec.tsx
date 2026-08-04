// apps/mobile/src/app/__tests__/render/kyc-status.render-spec.tsx · DEV-46 render-floor test for
// src/app/(farmer)/kyc/index.tsx (pilot-ON module 2: farmer/buyer onboarding KYC-lite — master-plan §2.1 row 2).
// The `kyc` flag defaults OFF (apps/mobile/src/core/flags/flags.ts DEFAULTS.kyc = false, unmocked — this test
// exercises the REAL flag store, not a stand-in) so the screen must take its flag-gated EmptyState branch before
// ever calling `listKyc()`. `features/kyc/kyc.api` is still mocked so the module's own `apiClient` import chain
// never has to resolve. `core/security/screen-guard` mocked (native `expo-screen-capture`, out of scope here).
import React from 'react';
import { EmptyState } from '@krishalaya/ui-native';
import { renderScreen } from '../../../test-utils/render';
import KycStatus from '../../(farmer)/kyc/index';

jest.mock('../../../features/kyc/kyc.api', () => ({ listKyc: jest.fn(async () => []) }));
jest.mock('../../../core/security/screen-guard', () => ({ useSecureScreen: () => {} }));

describe('(farmer)/kyc/index — render floor', () => {
  it('renders without throwing and honors the flag-OFF EmptyState (kyc defaults OFF)', async () => {
    const renderer = await renderScreen(<KycStatus />);
    const empty = renderer.root.findByType(EmptyState);
    expect(empty.props.title).toBeTruthy();
  });
});
