// apps/mobile/src/app/__tests__/render/farmer-orders.render-spec.tsx · DEV-46 render-floor test for
// src/app/(farmer)/orders.tsx (pilot-ON module 4: direct orders + checkout — master-plan §2.1 row 4, seller/
// buyer combined tab). No flag gate of its own — the render-floor assertion is the DATA-empty EmptyState path:
// `listOrders()` mocked to resolve zero items for both the buyer and seller role calls it fires in parallel.
import React from 'react';
import { EmptyState } from '@krishi-verse/ui-native';
import { renderScreen } from '../../../test-utils/render';
import Orders from '../../(farmer)/orders';

jest.mock('../../../features/orders/orders.api', () => ({
  listOrders: jest.fn(async () => ({ items: [], nextCursor: null })),
}));
jest.mock('../../../features/payments/payments.api', () => ({
  payForOrder: jest.fn(async () => ({ outcome: 'success' })),
}));

describe('(farmer)/orders — render floor', () => {
  it('renders without throwing and shows the empty-orders state once load settles', async () => {
    const renderer = await renderScreen(<Orders />);
    const empty = renderer.root.findByType(EmptyState);
    expect(empty.props.title).toBeTruthy();
  });
});
