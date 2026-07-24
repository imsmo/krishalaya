// apps/mobile/src/app/__tests__/render/verify.render-spec.tsx · DEV-46 render-floor test for
// src/app/(auth)/verify.tsx (pilot-ON module 1: Auth/OTP). Mocks: `core/auth/otp.flow` (SDK-reaching), `core/
// util/ids` (native expo-crypto), `core/auth/auth.store` (useAuth — the real store wires token-store/secure-store/
// api-client/observability at import time, all out of scope here), and `core/security` (useSecureScreen — the
// real hook calls the native `expo-screen-capture` module; mocked to a no-op rather than adding a native-module
// mock, mirroring how every other secure screen in this batch is handled). `searchParams.phone` is set so the
// screen renders the real entered-number line.
import React from 'react';
import { OtpInput } from '@krishi-verse/ui-native';
import { renderScreen } from '../../../test-utils/render';
import { searchParams, resetExpoRouterMock } from '../../../test-utils/expo-router-mock';
import VerifyScreen from '../../(auth)/verify';

jest.mock('../../../core/auth/otp.flow', () => ({
  verifyOtp: jest.fn(async () => ({ accessToken: 'a', refreshToken: 'b' })),
  requestOtp: jest.fn(async () => {}),
  resendSecondsRemaining: jest.fn(() => 30),
}));
jest.mock('../../../core/util/ids', () => ({ newId: () => 'test-idempotency-key' }));
jest.mock('../../../core/auth/auth.store', () => ({ useAuth: () => ({ signIn: jest.fn(async () => {}) }) }));
jest.mock('../../../core/security', () => ({ useSecureScreen: () => {} }));

describe('(auth)/verify — render floor', () => {
  beforeEach(() => {
    resetExpoRouterMock();
    searchParams.phone = '+919876543210';
  });

  it('renders without throwing and shows the OTP input for the entered number', async () => {
    const renderer = await renderScreen(<VerifyScreen />);
    const otp = renderer.root.findByType(OtpInput);
    expect(otp).toBeTruthy();
  });
});
