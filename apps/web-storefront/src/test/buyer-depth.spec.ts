import { canCancelOrder, buildDisputeRaise, DISPUTE_REASONS } from '../features/orders/buyer-actions';
import { buildProfilePatch, buildAddress } from '../features/account/form';

describe('features/orders/buyer-actions (PC-24b)', () => {
  it('cancel legal only pre-fulfilment', () => {
    for (const s of ['created', 'payment_pending', 'confirmed', 'packed']) expect(canCancelOrder(s)).toBe(true);
    for (const s of ['ready', 'delivered', 'completed', 'cancelled', undefined, null]) expect(canCancelOrder(s as string)).toBe(false);
  });
  it('dispute raise requires a reason from the server enum; caps description', () => {
    expect(buildDisputeRaise({ orderId: 'o1', reasonCode: 'late', description: ' 3 days late ' }))
      .toEqual({ ok: true, value: { orderId: 'o1', reasonCode: 'late', description: '3 days late' } });
    expect(buildDisputeRaise({ orderId: 'o1', reasonCode: 'made_up' })).toEqual({ ok: false, error: 'reason' });
    expect(buildDisputeRaise({ orderId: 'o1', reasonCode: 'late', description: 'x'.repeat(4001) })).toEqual({ ok: false, error: 'description' });
    expect(DISPUTE_REASONS).toContain('poor_quality');
  });
});

describe('features/account/form (PC-24b)', () => {
  it('profile patch drops blanks, validates email, rejects no-op', () => {
    expect(buildProfilePatch({ fullName: ' Asha ', email: '' })).toEqual({ ok: true, value: { fullName: 'Asha' } });
    expect(buildProfilePatch({ email: 'not-an-email' })).toEqual({ ok: false, error: 'email' });
    expect(buildProfilePatch({})).toEqual({ ok: false, error: 'empty' });
  });
  it('address requires line1, validates 6-digit pincode + phone shape', () => {
    expect(buildAddress({ line1: 'Farm 12, NH-8' }).ok).toBe(true);
    expect(buildAddress({ line1: 'ab' })).toEqual({ ok: false, error: 'line1' });
    expect(buildAddress({ line1: 'Farm 12', pincode: '38800' })).toEqual({ ok: false, error: 'pincode' });
    expect(buildAddress({ line1: 'Farm 12', contactPhone: '12' })).toEqual({ ok: false, error: 'phone' });
    const r = buildAddress({ line1: 'Farm 12', pincode: '388001', contactPhone: '+91 90990 12340', isDefault: true });
    expect(r).toEqual({ ok: true, value: { line1: 'Farm 12', pincode: '388001', contactPhone: '+919099012340', isDefault: true } });
  });
});
