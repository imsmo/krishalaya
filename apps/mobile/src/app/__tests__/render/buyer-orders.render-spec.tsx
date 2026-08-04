// apps/mobile/src/app/__tests__/render/buyer-orders.render-spec.tsx · DEV-46 render-floor test for
// src/app/(buyer)/orders.tsx (pilot-ON module 4: direct orders + checkout — master-plan §2.1 row 4, buyer's own
// My Orders tab). The `buyer_app` flag defaults OFF (real flag store) so the screen takes its flag-gated
// EmptyState branch before `listOrders()` is ever called.
import React from 'react';
import { EmptyState } from '@krishalaya/ui-native';
import { renderScreen } from '../../../test-utils/render';
import BuyerOrders from '../../(buyer)/orders';

jest.mock('../../../features/orders/orders.api', () => ({
  listOrders: jest.fn(async () => ({ items: [], nextCursor: null })),
}));

describe('(buyer)/orders — render floor', () => {
  it('renders without throwing and honors the flag-OFF EmptyState (buyer_app defaults OFF)', async () => {
    const renderer = await renderScreen(<BuyerOrders />);
    const empty = renderer.root.findByType(EmptyState);
    expect(empty.props.title).toBeTruthy();
  });
});
