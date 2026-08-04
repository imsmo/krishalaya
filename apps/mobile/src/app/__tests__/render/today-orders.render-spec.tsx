// apps/mobile/src/app/__tests__/render/today-orders.render-spec.tsx · DEV-45 render-floor test for
// src/app/(owner)/today-orders.tsx (screen 547, tenant-admin-lite worklist). `tenant_admin_lite` defaults OFF
// (apps/mobile/src/core/flags/flags.ts DEFAULTS.tenant_admin_lite = false, unmocked here — exercises the REAL
// flag store, mirroring kyc-status.render-spec.tsx's own convention) so the screen must take its flag-gated
// EmptyState branch before ever calling `todayTenantOrderSummary()`. `features/orders/orders.api` is still
// mocked so the module's own `apiClient`/offline-cache import chain never has to resolve (same reason
// farmer-orders.render-spec.tsx mocks the sibling `listOrders` export from the same file). `core/deeplink` is
// also mocked: its `web-console.ts` sibling imports `core/config.ts`, which throws at MODULE-LOAD time (fail-
// closed, by design) when `EXPO_PUBLIC_API_URL` isn't set in this jest environment — a real bug this test caught
// on its first run (the screen's `openExport` handler only runs on a user tap, never during render, so this is
// purely an import-time config guard, not a runtime crash path in the real app).
import React from 'react';
import { EmptyState } from '@krishalaya/ui-native';
import { renderScreen } from '../../../test-utils/render';
import TodayOrders from '../../(owner)/today-orders';

const mockTodaySummary = jest.fn(async () => ({ orders: 0, gmvMinor: '0', currencyCode: 'INR', disputesOpen: 0, refundedOrders: 0 }));

jest.mock('../../../features/orders/orders.api', () => ({
  todayTenantOrderSummary: () => mockTodaySummary(),
}));
jest.mock('../../../core/deeplink', () => ({ openWebConsole: jest.fn(async () => true) }));

describe('(owner)/today-orders — render floor', () => {
  it('renders without throwing and honors the flag-OFF EmptyState (tenant_admin_lite defaults OFF)', async () => {
    const renderer = await renderScreen(<TodayOrders />);
    const empty = renderer.root.findByType(EmptyState);
    expect(empty.props.title).toBeTruthy();
    // the ON-path data call must never fire while the module is flagged off (degrade-never-die / Golden Law 8)
    expect(mockTodaySummary).not.toHaveBeenCalled();
  });
});
