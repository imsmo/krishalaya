// apps/mobile/src/app/__tests__/render/complaint.render-spec.tsx · DEV-46 render-floor test for
// src/app/(farmer)/profile/complaint.tsx (pilot-ON module 8: support, the "open + track a dispute" half —
// master-plan §2.1 row 8). The `farmer_profile` flag defaults OFF (real flag store) so the screen takes its
// flag-gated EmptyState branch before `openTicket()`/`listOrders()` ever run.
import React from 'react';
import { EmptyState } from '@krishalaya/ui-native';
import { renderScreen } from '../../../test-utils/render';
import Complaint from '../../(farmer)/profile/complaint';

jest.mock('../../../features/profile/profile.api', () => ({ openTicket: jest.fn(async () => ({ id: 't1' })) }));
jest.mock('../../../features/orders/orders.api', () => ({
  listOrders: jest.fn(async () => ({ items: [], nextCursor: null })),
}));

describe('(farmer)/profile/complaint — render floor', () => {
  it('renders without throwing and honors the flag-OFF EmptyState (farmer_profile defaults OFF)', async () => {
    const renderer = await renderScreen(<Complaint />);
    const empty = renderer.root.findByType(EmptyState);
    expect(empty.props.title).toBeTruthy();
  });
});
