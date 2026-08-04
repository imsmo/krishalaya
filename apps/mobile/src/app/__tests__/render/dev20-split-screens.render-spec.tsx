// apps/mobile/src/app/__tests__/render/dev20-split-screens.render-spec.tsx · DEV-20 (APPLY-9/Q49 tablet two-pane,
// honest-minimum) render-floor proof for the 2 representative list screens this batch wired:
// `(farmer)/listings/index.tsx` (My Listings) and `(farmer)/orders.tsx` (My Orders). Mocks `useSplitLayout`
// directly (its own dimension-reading logic is already unit-tested at the pure level in
// `core/__tests__/dev20-mechanisms.spec.ts` [QA-FIX 2026-07-26: corrected path — no `core/mechanisms/
// splitLayout.spec.ts` file exists]) so this file focuses on what the SCREEN does with the eligibility
// signal: renders a two-pane body with a "select an item to preview" prompt when split-eligible and nothing is
// selected yet, and — the regression proof — renders its plain pre-DEV-20 single-column body when not eligible
// (every existing DEV-46 render-floor assertion for these two screens keeps passing unmodified).
import React from 'react';
import { EmptyState } from '@krishalaya/ui-native';
import { renderScreen } from '../../../test-utils/render';
import MyListings from '../../(farmer)/listings/index';
import Orders from '../../(farmer)/orders';

import { useSplitLayout } from '../../../core/mechanisms/useSplitLayout';

jest.mock('../../../core/mechanisms/useSplitLayout', () => ({
  useSplitLayout: jest.fn(() => ({ isSplit: false, listColumnWidth: 280, maxWidth: 1100 })),
}));
const mockUseSplitLayout = useSplitLayout as jest.Mock;

jest.mock('../../../features/listings/listings.api', () => ({
  myListings: jest.fn(async () => ({
    items: [{
      id: 'l1', title: 'Wheat 40kg', priceMinor: '250000', currencyCode: 'INR', unitCode: 'quintal',
      quantityAvailable: 40, organicClaim: false, saleType: 'fixed', regionId: null, sellerUserId: 'u1',
      boosted: false, status: 'active',
    }],
    nextCursor: null,
  })),
}));
jest.mock('../../../features/wallet/wallet.api', () => ({
  walletEarnings: jest.fn(async () => ({ totalMinor: '0', byMonth: {} })),
}));
jest.mock('../../../features/orders/orders.api', () => ({
  listOrders: jest.fn(async () => ({
    items: [{
      id: 'o1', orderNo: 'ORD-1', status: 'in_transit', totalMinor: '150000', counterparty: 'Ramesh',
      createdAt: '2026-07-20T00:00:00.000Z', primaryItem: { title: 'Onion', quantity: 20, unitCode: 'kg' }, itemCount: 1,
    }],
    nextCursor: null,
  })),
}));
jest.mock('../../../features/payments/payments.api', () => ({
  payForOrder: jest.fn(async () => ({ outcome: 'success' })),
}));

describe('DEV-20 tablet two-pane (APPLY-9/Q49) — (farmer)/listings/index', () => {
  afterEach(() => { mockUseSplitLayout.mockReturnValue({ isSplit: false, listColumnWidth: 280, maxWidth: 1100 }); });

  it('phone viewport (isSplit false): renders the plain single-column list, no split-select prompt (regression-safe)', async () => {
    const renderer = await renderScreen(<MyListings />);
    const empties = renderer.root.findAllByType(EmptyState);
    expect(empties.some((n) => n.props.title === 'Select a listing to preview')).toBe(false);
  });

  it('split-eligible viewport (isSplit true, nothing selected yet): renders the preview pane\'s select-prompt', async () => {
    mockUseSplitLayout.mockReturnValue({ isSplit: true, listColumnWidth: 280, maxWidth: 1100 });
    const renderer = await renderScreen(<MyListings />);
    const empties = renderer.root.findAllByType(EmptyState);
    expect(empties.some((n) => n.props.title === 'Select a listing to preview')).toBe(true);
  });
});

describe('DEV-20 tablet two-pane (APPLY-9/Q49) — (farmer)/orders', () => {
  afterEach(() => { mockUseSplitLayout.mockReturnValue({ isSplit: false, listColumnWidth: 280, maxWidth: 1100 }); });

  it('phone viewport (isSplit false): renders the plain single-column list, no split-select prompt (regression-safe)', async () => {
    const renderer = await renderScreen(<Orders />);
    const empties = renderer.root.findAllByType(EmptyState);
    expect(empties.some((n) => n.props.title === 'Select an order to preview')).toBe(false);
  });

  it('split-eligible viewport (isSplit true, nothing selected yet): renders the preview pane\'s select-prompt', async () => {
    mockUseSplitLayout.mockReturnValue({ isSplit: true, listColumnWidth: 280, maxWidth: 1100 });
    const renderer = await renderScreen(<Orders />);
    const empties = renderer.root.findAllByType(EmptyState);
    expect(empties.some((n) => n.props.title === 'Select an order to preview')).toBe(true);
  });
});
