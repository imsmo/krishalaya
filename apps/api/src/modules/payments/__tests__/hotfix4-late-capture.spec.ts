// PC-56 HOTFIX-4 · A3 (survey F-4a / B6) — a gateway order's FAILED attempt followed by ANOTHER attempt's capture is booked; the failed
// attempt's own id is refused by name; a replayed capture is recognised. Pure domain (the live spec books it through the real webhook).
import { Payment } from '../domain/payment.entity';
import { canTransition } from '../domain/payment.state';
import { LateCaptureSameAttemptError } from '../domain/payments.errors';

const pay = () => {
  const p = Payment.initiate({ id: 'pay-1', tenantId: 'T', userId: 'U', purposeId: 'P', referenceType: 'order', referenceId: 'O',
    amountMinor: 10_000n, currencyCode: 'INR', providerCode: 'razorpay', idempotencyKey: 'k' });
  p.attachGatewayOrder('order_G1');
  p.pullEvents();
  return p;
};

describe('HOTFIX-4 · A3 late capture after a recorded failure', () => {
  it('the state machine allows failed → success (the entity decides WHICH capture)', () => {
    expect(canTransition('failed', 'success')).toBe(true);
    expect(canTransition('failed', 'refunded')).toBe(false);
    // PC-56 STORE-2c · B3: a lapsed attempt's late capture is booked too (payment.state `expired → success`)
    expect(canTransition('expired', 'success')).toBe(true);
  });
  it('failed (attempt pay_A) → captured (attempt pay_B) → success, booked with pay_B; one Succeeded event', () => {
    const p = pay();
    expect(p.markFailed('BAD_REQUEST_ERROR', 'U30: per-transaction limit', 'pay_A')).toBe(true);
    expect(p.toProps().gatewayPaymentId).toBe('pay_A');
    p.pullEvents();
    expect(p.isLaterAttempt('pay_B')).toBe(true);
    expect(p.markCaptured('pay_B', 'upi', 'txn-1')).toBe(true);
    expect([p.status, p.toProps().gatewayPaymentId, p.toProps().ledgerTxnId]).toEqual(['success', 'pay_B', 'txn-1']);
    expect(p.pullEvents().map((e) => e.type)).toEqual(['payments.payment_succeeded']);
  });
  it('the FAILED attempt\'s own id cannot be captured into success — refused by name, nothing changes', () => {
    const p = pay();
    p.markFailed('X', 'y', 'pay_A');
    expect(p.isLaterAttempt('pay_A')).toBe(false);
    expect(() => p.markCaptured('pay_A', 'upi', 'txn-1')).toThrow(LateCaptureSameAttemptError);
    expect(() => p.markCaptured('', 'upi', 'txn-1')).toThrow(LateCaptureSameAttemptError);
    expect(p.status).toBe('failed');
  });
  it('a replay of the booked capture is recognised (same id, success) — markCaptured is a no-op', () => {
    const p = pay();
    p.markCaptured('pay_B', 'upi', 'txn-1');
    expect(p.isCaptureReplay('pay_B')).toBe(true);
    expect(p.isCaptureReplay('pay_C')).toBe(false);
    expect(p.markCaptured('pay_B', 'upi', 'txn-2')).toBe(false);
    expect(p.toProps().ledgerTxnId).toBe('txn-1');
  });
  it('a failure with no gateway payment id keeps any later capture bookable (nothing to tell apart)', () => {
    const p = pay();
    p.markFailed('X', 'y');
    expect(p.toProps().gatewayPaymentId).toBeNull();
    expect(p.markCaptured('pay_Z', 'card', 'txn-9')).toBe(true);
  });
});
