// apps/mobile/src/app/__tests__/render/my-listings.render-spec.tsx · DEV-46 render-floor test for
// src/app/(farmer)/listings/index.tsx (pilot-ON module 3: Listings — master-plan §2.1 row 3). This screen has no
// flag gate of its own (listings is GA-complete per its header comment) — the render-floor assertion here is the
// DATA-empty EmptyState path instead: `myListings()` mocked to resolve zero items, proving the list screen
// degrades to the designed "no listings yet" panel rather than a blank/crashed list once its load-on-focus
// effect settles (renderScreen flushes one tick for exactly this).
import React from 'react';
import { EmptyState } from '@krishi-verse/ui-native';
import { renderScreen } from '../../../test-utils/render';
import MyListings from '../../(farmer)/listings/index';

jest.mock('../../../features/listings/listings.api', () => ({
  myListings: jest.fn(async () => ({ items: [], nextCursor: null })),
}));
jest.mock('../../../features/wallet/wallet.api', () => ({
  walletEarnings: jest.fn(async () => ({ totalMinor: '0', byMonth: {} })),
}));

describe('(farmer)/listings/index — render floor', () => {
  it('renders without throwing and shows the empty-listings state once load settles', async () => {
    const renderer = await renderScreen(<MyListings />);
    const empty = renderer.root.findByType(EmptyState);
    expect(empty.props.title).toBeTruthy();
  });
});
