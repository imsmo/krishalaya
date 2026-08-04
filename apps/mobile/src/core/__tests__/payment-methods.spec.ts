// Unit tests for the PURE payment-step logic (screen 130). No React/native deps.
import { walletCovers, walletShortfallMinor, previewItemCount } from '../../features/cart/payment-methods';
import type { CheckoutPreview } from '@krishalaya/sdk-js';

describe('payment step (screen 130)', () => {
  it('walletCovers: balance ≥ total', () => {
    expect(walletCovers('2996000', '2996000')).toBe(true);
    expect(walletCovers('1220000', '2996000')).toBe(false); // ₹12,200 < ₹29,960
    expect(walletCovers('bad', '10')).toBe(false);
  });
  it('walletShortfallMinor = total − balance when short, else null', () => {
    expect(walletShortfallMinor('1220000', '2996000')).toBe('1776000'); // need ₹17,760 more
    expect(walletShortfallMinor('2996000', '2996000')).toBeNull();
    expect(walletShortfallMinor('3000000', '2996000')).toBeNull();
  });
  it('previewItemCount sums items across sellers; 0 without a preview', () => {
    const preview = { sellers: [{ items: [1, 2] }, { items: [3] }] } as unknown as CheckoutPreview;
    expect(previewItemCount(preview)).toBe(3);
    expect(previewItemCount(null)).toBe(0);
  });
});
