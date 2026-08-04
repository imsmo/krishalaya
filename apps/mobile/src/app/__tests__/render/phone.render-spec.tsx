// apps/mobile/src/app/__tests__/render/phone.render-spec.tsx · DEV-46 render-floor test for
// src/app/(auth)/phone.tsx (pilot-ON module 1: Auth/OTP). No flag gate (pre-login screen). Mocks
// `core/auth/otp.flow` (real module reaches the SDK's anonClient — out of scope for a render-floor test) and
// `core/util/ids` (real `newId()` calls the native `expo-crypto` module, which has no jest mock in this harness
// — mocked at this same boundary rather than adding an expo-crypto mock, since phone.tsx is the only screen in
// this batch's 15 that calls `newId()` directly at import/render time via a handler, not on mount).
import React from 'react';
import { Input } from '@krishalaya/ui-native';
import { renderScreen } from '../../../test-utils/render';
import PhoneScreen from '../../(auth)/phone';

jest.mock('../../../core/auth/otp.flow', () => ({
  normalizeIndianPhone: jest.fn((raw: string) => raw),
  requestOtp: jest.fn(async () => {}),
}));
jest.mock('../../../core/util/ids', () => ({ newId: () => 'test-idempotency-key' }));

describe('(auth)/phone — render floor', () => {
  it('renders without throwing and shows the phone Input', async () => {
    const renderer = await renderScreen(<PhoneScreen />);
    const input = renderer.root.findByType(Input);
    expect(input.props.label).toBeTruthy();
  });
});
