// apps/mobile/src/app/__tests__/render/notifications-inbox.render-spec.tsx · DEV-46 render-floor test for
// src/app/(farmer)/notifications/index.tsx (pilot-ON module 7: notifications — master-plan §2.1 row 7). The
// `notifications` flag defaults OFF (real flag store) so the screen takes its flag-gated EmptyState branch
// before `inbox()` is ever called.
import React from 'react';
import { EmptyState } from '@krishalaya/ui-native';
import { renderScreen } from '../../../test-utils/render';
import NotificationInbox from '../../(farmer)/notifications/index';

jest.mock('../../../features/notifications/notifications.api', () => ({
  inbox: jest.fn(async () => ({ items: [], nextCursor: null })),
  markAllRead: jest.fn(async () => {}),
}));

describe('(farmer)/notifications/index — render floor', () => {
  it('renders without throwing and honors the flag-OFF EmptyState (notifications defaults OFF)', async () => {
    const renderer = await renderScreen(<NotificationInbox />);
    const empty = renderer.root.findByType(EmptyState);
    expect(empty.props.title).toBeTruthy();
  });
});
