// Unit tests for the PURE delivery-step logic (screen 129). No React/native deps.
import { defaultMethodId, deliverySavingMinor } from '../../features/cart/delivery';
import type { DeliveryMethod } from '@krishalaya/sdk-js';

const M: DeliveryMethod[] = [
  { id: 'pickup', name: 'Pickup', feeMinor: '0' },
  { id: 'std', name: 'Standard', feeMinor: '40000' },   // ₹400
  { id: 'exp', name: 'Express', feeMinor: '45000' },     // ₹450
];

describe('delivery step (screen 129)', () => {
  it('defaultMethodId keeps a valid pick, else falls back to the first, else null', () => {
    expect(defaultMethodId(M, 'std')).toBe('std');
    expect(defaultMethodId(M, 'gone')).toBe('pickup');
    expect(defaultMethodId(M, null)).toBe('pickup');
    expect(defaultMethodId([], 'x')).toBeNull();
  });
  it('deliverySavingMinor = dearest fee − this fee (bigint), null when it saves nothing', () => {
    expect(deliverySavingMinor('pickup', M)).toBe('45000'); // saves ₹450 vs express
    expect(deliverySavingMinor('std', M)).toBe('5000');     // ₹50 cheaper than express
    expect(deliverySavingMinor('exp', M)).toBeNull();       // dearest → saves nothing
    expect(deliverySavingMinor('gone', M)).toBeNull();
  });
});
