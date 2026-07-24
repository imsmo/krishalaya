// apps/mobile/src/app/__tests__/render/wallet-home.render-spec.tsx · DEV-46 render-floor test for
// src/app/(farmer)/wallet/index.tsx (pilot-ON module 5: wallet + escrow + payout — master-plan §2.1 row 5). Two
// cases: (1) the default degrade-never-die floor — a healthy zero-balance/zero-entries read renders the
// designed "no transactions" EmptyState, never a blank screen; (2) the screen's own documented R2-01 degrade-
// never-die guarantee — a FAILED balance read must show a distinct retry affordance, never a confident "₹0.00"
// that looks identical to a genuine zero balance (this screen's own header comment names this exact bug). This
// is the one screen in the pilot-ON set whose header explicitly documents a degrade-never-die state machine, so
// it is the one given the extra assertion per the task's "surfaces degrade-never-die states where applicable".
// (mock* variable naming below is required, not stylistic — babel-plugin-jest-hoist only allows a jest.mock()
// factory to close over identifiers prefixed `mock`, so per-test-controllable mock functions must be named this
// way; a first pass named them `walletBalance` etc. and failed with "module factory ... out-of-scope variables".)
import React from 'react';
import { Text } from 'react-native';
import { EmptyState } from '@krishi-verse/ui-native';
import { renderScreen } from '../../../test-utils/render';
import WalletHome from '../../(farmer)/wallet/index';

const mockWalletBalance = jest.fn();
const mockWalletLedger = jest.fn(async () => ({ items: [], nextCursor: null }));
const mockWalletEarnings = jest.fn(async () => ({ totalMinor: '0', byMonth: [] }));
const mockListPayouts = jest.fn(async () => ({ items: [], nextCursor: null }));

jest.mock('../../../features/wallet/wallet.api', () => ({
  walletBalance: () => mockWalletBalance(),
  walletLedger: () => mockWalletLedger(),
  walletEarnings: () => mockWalletEarnings(),
  listPayouts: () => mockListPayouts(),
}));
jest.mock('../../../core/security', () => ({ useSecureScreen: () => {} }));

describe('(farmer)/wallet/index — render floor', () => {
  beforeEach(() => { mockWalletBalance.mockReset(); });

  it('renders without throwing and shows the empty-transactions state on a healthy zero balance', async () => {
    mockWalletBalance.mockResolvedValue({ availableMinor: '0', heldMinor: '0', failed: false });
    const renderer = await renderScreen(<WalletHome />);
    const empty = renderer.root.findByType(EmptyState);
    expect(empty.props.title).toBeTruthy();
  });

  it('degrade-never-die: a FAILED balance read shows the retry line, never a fabricated confident balance', async () => {
    mockWalletBalance.mockResolvedValue({ availableMinor: '0', heldMinor: '0', failed: true });
    const renderer = await renderScreen(<WalletHome />);
    const texts = renderer.root.findAllByType(Text).map((n) => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children));
    expect(texts).toContain("Couldn't load balance. Tap to retry.");
  });
});
