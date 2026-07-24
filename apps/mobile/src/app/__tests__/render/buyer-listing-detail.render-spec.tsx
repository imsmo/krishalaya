// apps/mobile/src/app/__tests__/render/buyer-listing-detail.render-spec.tsx · DEV-46 render-floor test for
// src/app/(buyer)/listings/[id].tsx (pilot-ON module 3: Listings, buyer side). The `buyer_app` flag defaults OFF
// (real flag store) so the screen takes its flag-gated EmptyState branch immediately, before any of the four
// feature APIs it imports (browse/saved/cart/messaging) ever run. Those four are still mocked so none of their
// real `apiClient` import chains resolve at module-load time.
import React from 'react';
import { EmptyState } from '@krishi-verse/ui-native';
import { renderScreen } from '../../../test-utils/render';
import { searchParams, resetExpoRouterMock } from '../../../test-utils/expo-router-mock';
import BuyerListingDetail from '../../(buyer)/listings/[id]';

jest.mock('../../../features/buyer/browse.api', () => ({
  getPublicListing: jest.fn(async () => null),
  sellerSummary: jest.fn(async () => null),
}));
jest.mock('../../../features/buyer/saved.api', () => ({
  getSavedListings: jest.fn(async () => []),
  toggleSavedListing: jest.fn(async () => []),
}));
jest.mock('../../../features/cart/cart.api', () => ({ addToCart: jest.fn(async () => true) }));
jest.mock('../../../features/messaging/messaging.api', () => ({ openDirect: jest.fn(async () => ({ id: 'c1' })) }));

describe('(buyer)/listings/[id] — render floor', () => {
  beforeEach(() => { resetExpoRouterMock(); searchParams.id = 'listing-1'; });

  it('renders without throwing and honors the flag-OFF EmptyState (buyer_app defaults OFF)', async () => {
    const renderer = await renderScreen(<BuyerListingDetail />);
    const empty = renderer.root.findByType(EmptyState);
    expect(empty.props.title).toBeTruthy();
  });
});
