// apps/mobile/src/app/__tests__/render/lint1-payment-error.render-spec.tsx · PC-56 LINT-1 — the one real bug the mobile lint
// found. (buyer)/payment set an error when placing the order failed, but nothing rendered it: the buyer tapped Pay and the
// screen just stopped spinning. Now the error shows in the footer above Pay. Each case fails on the old screen (no such Text).
import React from 'react';
import { Text } from 'react-native';
import { act } from 'react-test-renderer';
import { Button } from '@krishalaya/ui-native';
import { SdkError } from '@krishalaya/sdk-js';
import { renderScreen } from '../../../test-utils/render';
import { mockReplace, resetExpoRouterMock } from '../../../test-utils/expo-router-mock';
import Payment from '../../(buyer)/payment';

const mockPlaceOrder = jest.fn();

jest.mock('../../../core/flags/useFlag', () => ({ useFlag: () => true }));
jest.mock('../../../core/security/screen-guard', () => ({ useSecureScreen: () => {} }));
jest.mock('../../../features/cart/cart.api', () => ({
  checkoutPreview: jest.fn(async () => ({
    currencyCode: 'INR', subtotalMinor: '50000', deliveryFeeMinor: '0', platformFeeMinor: '0', discountMinor: '0',
    grandTotalMinor: '50000', sellers: [{ items: [{}] }],
  })),
  placeOrder: (...args: unknown[]) => mockPlaceOrder(...args),
}));
jest.mock('../../../features/wallet/wallet.api', () => ({
  walletBalance: jest.fn(async () => ({ availableMinor: '0', heldMinor: '0', failed: false })),
}));
jest.mock('../../../features/payments/payments.api', () => ({
  payForOrder: jest.fn(async () => ({ outcome: 'success' })),
  payOrderFromWallet: jest.fn(async () => ({ outcome: 'success' })),
}));

type R = Awaited<ReturnType<typeof renderScreen>>;
const flat = (x: unknown): string => (Array.isArray(x) ? x.map(flat).join('') : typeof x === 'string' || typeof x === 'number' ? String(x) : '');
const texts = (r: R): string[] => r.root.findAllByType(Text).map((n) => flat(n.props.children));
const pay = async (r: R) => {
  const btn = r.root.findAllByType(Button).find((b) => String(b.props.title).startsWith('Pay '));
  expect(btn).toBeTruthy();
  await act(async () => { await btn!.props.onPress(); });
};

beforeEach(() => { resetExpoRouterMock(); mockPlaceOrder.mockReset(); });

describe('LINT-1 · (buyer)/payment shows why placing the order failed', () => {
  it('a 409 (cart changed) shows the "cart changed" message and stays on the screen', async () => {
    mockPlaceOrder.mockRejectedValue(new SdkError('CART_CHANGED', 409, 'changed'));
    const r = await renderScreen(<Payment />);
    await pay(r);
    expect(texts(r)).toContain('Something changed in your cart. Please review and retry.');
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('a 422 shows the coupon message', async () => {
    mockPlaceOrder.mockRejectedValue(new SdkError('VALIDATION', 422, 'bad coupon'));
    const r = await renderScreen(<Payment />);
    await pay(r);
    expect(texts(r)).toContain("That coupon isn't valid.");
  });

  it('no order returned shows the generic failure', async () => {
    mockPlaceOrder.mockResolvedValue({ orders: [] });
    const r = await renderScreen(<Payment />);
    await pay(r);
    expect(texts(r)).toContain('Could not place the order. Please try again.');
  });

  it('the error clears on the next attempt and success navigates to the order', async () => {
    mockPlaceOrder.mockRejectedValueOnce(new SdkError('CART_CHANGED', 409, 'changed'));
    mockPlaceOrder.mockResolvedValueOnce({ orders: [{ id: 'ord-1', totalMinor: '0' }] });
    const r = await renderScreen(<Payment />);
    await pay(r);
    expect(texts(r)).toContain('Something changed in your cart. Please review and retry.');
    await pay(r);
    expect(texts(r)).not.toContain('Something changed in your cart. Please review and retry.');
    expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/(buyer)/orders/[id]', params: expect.objectContaining({ id: 'ord-1' }) }));
  });
});
