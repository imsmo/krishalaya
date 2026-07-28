// apps/mobile/src/app/__tests__/render/dev28-per-row-detail.render-spec.tsx · DEV-28 (APPLY-9 per-row tablet
// routing, this batch's own scoped follow-up to DEV-20's mechanism) render-floor proof for the real per-row
// detail fetch added to `(farmer)/listings/index.tsx` + `(farmer)/orders.tsx`. DEV-20's own render-spec
// (`dev20-split-screens.render-spec.tsx`) already covers the mechanism itself (split-eligible layout renders,
// phone falls back unchanged) — this file covers ONLY what DEV-28 adds on top: selecting a row fires exactly one
// real, id-scoped fetch (`getListing`+`listingAnalytics` / `getOrder`), the pane upgrades in place once it
// resolves, a fast reselect keeps only the latest row's data (race guard), a fetch failure degrades to the
// still-visible list snapshot (Law 12), and — the Law 11 regression proof — a phone-viewport tap never fires
// the detail fetch at all (it navigates instead, same as pre-DEV-28).
import React from 'react';
import { act } from 'react-test-renderer';
import { Pressable, Text } from 'react-native';
import { renderScreen } from '../../../test-utils/render';
import { mockPush, resetExpoRouterMock } from '../../../test-utils/expo-router-mock';
import MyListings from '../../(farmer)/listings/index';
import Orders from '../../(farmer)/orders';

import { useSplitLayout } from '../../../core/mechanisms/useSplitLayout';

jest.mock('../../../core/mechanisms/useSplitLayout', () => ({
  useSplitLayout: jest.fn(() => ({ isSplit: true, listColumnWidth: 280, maxWidth: 1100 })),
}));
const mockUseSplitLayout = useSplitLayout as jest.Mock;

const mockGetListing = jest.fn();
const mockListingAnalytics = jest.fn();
jest.mock('../../../features/listings/listings.api', () => ({
  myListings: jest.fn(async () => ({
    items: [
      { id: 'l1', title: 'Wheat 40kg', priceMinor: '250000', currencyCode: 'INR', unitCode: 'quintal', quantityAvailable: 40, organicClaim: false, saleType: 'fixed', regionId: null, sellerUserId: 'u1', boosted: false, status: 'active' },
      { id: 'l2', title: 'Onion 60kg', priceMinor: '180000', currencyCode: 'INR', unitCode: 'quintal', quantityAvailable: 60, organicClaim: false, saleType: 'fixed', regionId: null, sellerUserId: 'u1', boosted: false, status: 'active' },
    ],
    nextCursor: null,
  })),
  getListing: (...args: unknown[]) => mockGetListing(...args),
  listingAnalytics: (...args: unknown[]) => mockListingAnalytics(...args),
}));
jest.mock('../../../features/wallet/wallet.api', () => ({
  walletEarnings: jest.fn(async () => ({ totalMinor: '0', byMonth: {} })),
}));

const mockGetOrder = jest.fn();
jest.mock('../../../features/orders/orders.api', () => ({
  listOrders: jest.fn(async () => ({
    items: [
      { id: 'o1', orderNo: 'ORD-1', status: 'in_transit', totalMinor: '150000', counterparty: 'Ramesh', createdAt: '2026-07-20T00:00:00.000Z', primaryItem: { title: 'Onion', quantity: 20, unitCode: 'kg' }, itemCount: 1 },
      { id: 'o2', orderNo: 'ORD-2', status: 'delivered', totalMinor: '90000', counterparty: 'Suresh', createdAt: '2026-07-21T00:00:00.000Z', primaryItem: { title: 'Wheat', quantity: 10, unitCode: 'kg' }, itemCount: 1 },
    ],
    nextCursor: null,
  })),
  getOrder: (...args: unknown[]) => mockGetOrder(...args),
}));
jest.mock('../../../features/payments/payments.api', () => ({
  payForOrder: jest.fn(async () => ({ outcome: 'success' })),
}));

/** Flush queued microtasks (mocked async fetch + its setState) inside an `act`. */
async function flush(): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
}

/** Find and invoke the first Pressable whose own accessibilityLabel/child text includes `needle`. */
async function tapRowContaining(renderer: { root: { findAllByType: (t: unknown) => { props: Record<string, unknown> }[] } }, needle: string): Promise<void> {
  const candidates = renderer.root.findAllByType(Pressable).filter((n) => {
    const label = n.props.accessibilityLabel;
    return typeof label === 'string' && label.includes(needle);
  });
  expect(candidates.length).toBeGreaterThan(0);
  await act(async () => { (candidates[0].props.onPress as () => void)(); });
}

function findText(renderer: { root: { findAllByType: (t: unknown) => { props: Record<string, unknown> }[] } }, text: string): boolean {
  return renderer.root.findAllByType(Text).some((n) => {
    const children = n.props.children;
    const flat = Array.isArray(children) ? children.join('') : children;
    return typeof flat === 'string' && flat.includes(text);
  });
}

beforeEach(() => {
  resetExpoRouterMock();
  mockUseSplitLayout.mockReturnValue({ isSplit: true, listColumnWidth: 280, maxWidth: 1100 });
  mockGetListing.mockReset();
  mockListingAnalytics.mockReset();
  mockGetOrder.mockReset();
});

describe('DEV-28 per-row tablet routing — (farmer)/listings/index', () => {
  it('selecting a row fires exactly ONE real, id-scoped fetch and upgrades the pane with real analytics', async () => {
    mockGetListing.mockResolvedValue({ listing: { id: 'l1', title: 'Wheat 40kg', priceMinor: '250000', currencyCode: 'INR', unitCode: 'quintal', quantityAvailable: 40, organicClaim: false, saleType: 'fixed', regionId: null, sellerUserId: 'u1', boosted: false, status: 'active' }, status: 200 });
    mockListingAnalytics.mockResolvedValue({ listingId: 'l1', status: 'active', publishedAt: null, offers: 7, priceChanges: 0, boostsPurchased: 0, views: 42, lastViewedAt: null, savedCount: 0, viewsByDay: [], activeBoost: null });

    const renderer = await renderScreen(<MyListings />);
    await tapRowContaining(renderer, 'Wheat 40kg');
    await flush();

    expect(mockGetListing).toHaveBeenCalledTimes(1);
    expect(mockGetListing).toHaveBeenCalledWith('l1');
    expect(mockListingAnalytics).toHaveBeenCalledTimes(1);
    expect(findText(renderer, '42')).toBe(true); // real views count from the fetched analytics
  });

  it('a fast reselect keeps only the LATEST row\'s data (race guard) — the stale response is dropped', async () => {
    let resolveL1!: (v: unknown) => void;
    mockGetListing.mockImplementation((id: string) => {
      if (id === 'l1') return new Promise((resolve) => { resolveL1 = resolve; });
      return Promise.resolve({ listing: { id: 'l2', title: 'Onion 60kg', priceMinor: '180000', currencyCode: 'INR', unitCode: 'quintal', quantityAvailable: 60, organicClaim: false, saleType: 'fixed', regionId: null, sellerUserId: 'u1', boosted: false, status: 'active' }, status: 200 });
    });
    mockListingAnalytics.mockImplementation((id: string) =>
      Promise.resolve({ listingId: id, status: 'active', publishedAt: null, offers: 0, priceChanges: 0, boostsPurchased: 0, views: id === 'l1' ? 999 : 5, lastViewedAt: null, savedCount: 0, viewsByDay: [], activeBoost: null }),
    );

    const renderer = await renderScreen(<MyListings />);
    await tapRowContaining(renderer, 'Wheat 40kg'); // selects l1 — fetch left pending (resolveL1 not yet called)
    await tapRowContaining(renderer, 'Onion 60kg'); // reselects l2 before l1's fetch resolves
    await flush();

    // now resolve the ABANDONED l1 fetch late — its own effect cleanup already fired (selectedId moved to l2), so
    // this stale response must be dropped, never overwriting l2's already-applied data
    await act(async () => { resolveL1({ listing: { id: 'l1', title: 'Wheat 40kg (STALE)', priceMinor: '1', currencyCode: 'INR', unitCode: 'quintal', quantityAvailable: 1, organicClaim: false, saleType: 'fixed', regionId: null, sellerUserId: 'u1', boosted: false, status: 'active' }, status: 200 }); });
    await flush();

    expect(findText(renderer, 'Wheat 40kg (STALE)')).toBe(false); // stale l1 response never rendered
    expect(findText(renderer, '999')).toBe(false); // stale l1 analytics never rendered
    expect(findText(renderer, '5')).toBe(true); // l2's real analytics did render
  });

  it('a fetch failure degrades to the already-visible list snapshot — never a blank pane (Law 12)', async () => {
    mockGetListing.mockResolvedValue({ listing: null, status: 404 });
    mockListingAnalytics.mockResolvedValue(null);

    const renderer = await renderScreen(<MyListings />);
    await tapRowContaining(renderer, 'Wheat 40kg');
    await flush();

    expect(findText(renderer, 'Wheat 40kg')).toBe(true); // the list snapshot itself never disappears
  });

  it('phone viewport (isSplit false): tapping a row navigates — the DEV-28 detail fetch never fires (Law 11)', async () => {
    mockUseSplitLayout.mockReturnValue({ isSplit: false, listColumnWidth: 280, maxWidth: 1100 });
    const renderer = await renderScreen(<MyListings />);
    await tapRowContaining(renderer, 'Wheat 40kg');
    await flush();

    expect(mockGetListing).not.toHaveBeenCalled();
    expect(mockListingAnalytics).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalled(); // real navigation happened instead, unchanged from pre-DEV-28
  });
});

describe('DEV-28 per-row tablet routing — (farmer)/orders', () => {
  it('selecting a row fires exactly ONE real getOrder(id) fetch and upgrades the pane with the real cost breakdown', async () => {
    // `title_snapshot` deliberately differs from the list-snapshot's own `primaryItem.title` ("Onion") so this
    // assertion proves the FETCHED detail rendered (not just the pre-existing, always-available list snapshot).
    mockGetOrder.mockResolvedValue({
      id: 'o1', orderNo: 'ORD-1', status: 'in_transit', source: 'app', buyerUserId: 'b1', sellerUserId: 's1', currencyCode: 'INR',
      subtotalMinor: '140000', deliveryFeeMinor: '5000', discountMinor: '0', taxMinor: '5000', commissionMinor: '0', totalMinor: '150000',
      items: [{ listing_id: 'l1', product_id: null, title_snapshot: 'Onion (verified 20kg)', quantity: 20, delivered_quantity: null, unit_code: 'kg', unit_price_minor: '7000', line_total_minor: '140000', gst_rate_pct: null, batch_id: null }],
    });

    const renderer = await renderScreen(<Orders />);
    await tapRowContaining(renderer, 'ORD-1');
    await flush();

    expect(mockGetOrder).toHaveBeenCalledTimes(1);
    expect(mockGetOrder).toHaveBeenCalledWith('o1');
    expect(findText(renderer, 'Onion (verified 20kg)')).toBe(true); // real fetched item line, not the snapshot
  });

  it('a fetch failure degrades to the already-visible order-list snapshot summary (Law 12)', async () => {
    mockGetOrder.mockResolvedValue(null);
    const renderer = await renderScreen(<Orders />);
    await tapRowContaining(renderer, 'ORD-1');
    await flush();

    expect(findText(renderer, 'ORD-1')).toBe(true); // the list-snapshot header still renders
  });

  it('phone viewport (isSplit false): tapping a row navigates — the DEV-28 detail fetch never fires (Law 11)', async () => {
    mockUseSplitLayout.mockReturnValue({ isSplit: false, listColumnWidth: 280, maxWidth: 1100 });
    const renderer = await renderScreen(<Orders />);
    await tapRowContaining(renderer, 'ORD-1');
    await flush();

    expect(mockGetOrder).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalled();
  });
});
