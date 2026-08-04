// apps/mobile/src/app/__tests__/render/checkout.render-spec.tsx · DEV-46 render-floor test for
// src/app/(buyer)/checkout.tsx (pilot-ON module 4: direct orders + checkout — master-plan §2.1 row 4). The
// `buyer_checkout` flag defaults OFF (real flag store) so the screen takes its flag-gated EmptyState branch
// before any of its four feature APIs (cart/addresses/wallet/payments) run. `core/security/screen-guard` mocked
// (native expo-screen-capture, same pattern as every other secure screen in this batch).
import React from 'react';
import { EmptyState } from '@krishalaya/ui-native';
import { renderScreen } from '../../../test-utils/render';
import Checkout from '../../(buyer)/checkout';

jest.mock('../../../core/security/screen-guard', () => ({ useSecureScreen: () => {} }));
jest.mock('../../../features/cart/cart.api', () => ({
  getCart: jest.fn(async () => ({ items: [] })),
  checkoutPreview: jest.fn(async () => null),
  deliveryMethods: jest.fn(async () => ({ methods: [] })),
  placeOrder: jest.fn(async () => ({ orders: [] })),
}));
jest.mock('../../../features/addresses/addresses.api', () => ({ listAddresses: jest.fn(async () => []) }));
jest.mock('../../../features/wallet/wallet.api', () => ({
  walletBalance: jest.fn(async () => ({ availableMinor: '0', heldMinor: '0', failed: false })),
}));
jest.mock('../../../features/payments/payments.api', () => ({
  payForOrder: jest.fn(async () => ({ outcome: 'success' })),
  payOrderFromWallet: jest.fn(async () => ({ outcome: 'success' })),
}));

describe('(buyer)/checkout — render floor', () => {
  it('renders without throwing and honors the flag-OFF EmptyState (buyer_checkout defaults OFF)', async () => {
    const renderer = await renderScreen(<Checkout />);
    const empty = renderer.root.findByType(EmptyState);
    expect(empty.props.title).toBeTruthy();
  });
});
