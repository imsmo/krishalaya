import { canCancelOrder, buildDisputeRaise, DISPUTE_REASONS, canRequestReturn, buildReturnRequest, returnAlreadyOpen } from '../features/orders/buyer-actions';
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

// ---------------------------------------------------------------------------
describe('features/orders/buyer-actions — return request (PC-55 B8)', () => {
  const ORDER = '018f0000-0000-7000-8000-000000000001';

  it('offers a return only where a delivery has demonstrably happened', () => {
    // eligibility server-side comes from the orders.order_delivered handler's row (0025), not from the word itself
    for (const s of ['delivered', 'completed']) expect(canRequestReturn(s)).toBe(true);
    for (const s of ['created', 'confirmed', 'packed', 'ready', 'shipped', 'cancelled', '', undefined, null]) {
      expect(canRequestReturn(s as string)).toBe(false);
    }
  });

  it('reuses the dispute taxonomy verbatim — the API validates against the same enum', () => {
    for (const r of DISPUTE_REASONS) {
      expect(buildReturnRequest({ orderId: ORDER, reasonCode: r })).toEqual({ ok: true, value: { orderId: ORDER, reasonCode: r } });
    }
    // codes that read plausibly but are not in the lookup would be a 422 (unknown return reason)
    for (const bad of ['not_as_described', 'quality_issue', 'changed_my_mind', '', undefined]) {
      expect(buildReturnRequest({ orderId: ORDER, reasonCode: bad })).toEqual({ ok: false, error: 'reason' });
    }
  });

  it('sends nothing but the order and the reason (buyer/seller/refund are server-resolved)', () => {
    const built = buildReturnRequest({ orderId: ORDER, reasonCode: 'damaged' });
    expect(built.ok).toBe(true);
    if (built.ok) expect(Object.keys(built.value).sort()).toEqual(['orderId', 'reasonCode']);
  });

  it('names an already-open case so the buyer is not shown a form the API would 409', () => {
    for (const s of ['requested', 'approved', 'in_transit', 'received']) expect(returnAlreadyOpen(s)).toBe(true);
    for (const s of ['refunded', 'rejected', '', undefined, null]) expect(returnAlreadyOpen(s as string)).toBe(false);
  });
});
