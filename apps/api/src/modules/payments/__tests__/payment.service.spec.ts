// modules/payments/__tests__/payment.service.spec.ts · pure-domain unit tests: the payment_status
// state machine (Law 5) and the Payment aggregate's money invariants (Law 2 — bigint minor units).
import { canTransition, assertTransition, isTerminal, IllegalPaymentTransitionError, PAYMENT_STATUSES, PaymentStatus } from '../domain/payment.state';
import { Payment } from '../domain/payment.entity';
import { PaymentEventType } from '../domain/payments.events';
import { RefundExceedsPaymentError } from '../domain/payments.errors';

function initiate(amount = 150000n): Payment {
  return Payment.initiate({ id: 'p1', tenantId: 't1', userId: 'u1', purposeId: 'pp1', referenceType: 'order', referenceId: 'o1',
    amountMinor: amount, currencyCode: 'INR', providerCode: 'sandbox', idempotencyKey: 'k1' });
}

describe('payment.state machine', () => {
  it('allows documented transitions and forbids illegal ones', () => {
    expect(canTransition('initiated', 'success')).toBe(true);
    expect(canTransition('authorized', 'success')).toBe(true);
    expect(canTransition('success', 'refunded')).toBe(true);
    // PC-56 HOTFIX-4 · A3: a LATER attempt's capture on a failed gateway order is booked (the entity allows only a different gateway payment id)
    expect(canTransition('failed', 'success')).toBe(true);
    expect(() => assertTransition('refunded', 'success')).toThrow(IllegalPaymentTransitionError);
  });
  it('terminal states have no exits', () => {
    expect(isTerminal('refunded')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('expired')).toBe(true);
    // HOTFIX-4 · A3: `failed` stays terminal for every other purpose; its one exit is another attempt's capture (hotfix4-late-capture.spec)
    expect(canTransition('failed', 'refunded')).toBe(false);
    expect(canTransition('expired', 'success')).toBe(false);
  });
  it('covers every status without throwing', () => {
    for (const s of PAYMENT_STATUSES) expect(() => canTransition(s, 'success' as PaymentStatus)).not.toThrow();
  });
});

describe('Payment aggregate', () => {
  it('initiates positive-only and emits payment_initiated', () => {
    const p = initiate();
    expect(p.status).toBe('initiated');
    expect(p.pullEvents().map((e) => e.type)).toContain(PaymentEventType.Initiated);
    expect(() => Payment.initiate({ id: 'x', tenantId: 't', userId: 'u', purposeId: 'pp', referenceType: null, referenceId: null, amountMinor: 0n, currencyCode: 'INR', providerCode: 'sandbox', idempotencyKey: 'k' })).toThrow();
  });

  it('captures once (idempotent), records ledger link, emits payment_succeeded', () => {
    const p = initiate(); p.pullEvents();
    expect(p.markCaptured('pay_gw_1', 'upi', 'txn1')).toBe(true);
    expect(p.status).toBe('success');
    expect(p.toProps().ledgerTxnId).toBe('txn1');
    expect(p.pullEvents().map((e) => e.type)).toContain(PaymentEventType.Succeeded);
    expect(p.markCaptured('pay_gw_1', 'upi', 'txn1')).toBe(false); // replay is a no-op
  });

  it('partial then full refund walks success → partially_refunded → refunded', () => {
    const p = initiate(100000n); p.pullEvents(); p.markCaptured('g', 'card', 't'); p.pullEvents();
    p.refund(40000n, 'r1');
    expect(p.status).toBe('partially_refunded');
    expect(p.refundableMinor).toBe(60000n);
    p.refund(60000n, 'r2');
    expect(p.status).toBe('refunded');
    expect(p.refundableMinor).toBe(0n);
  });

  it('refusing to refund more than the refundable balance', () => {
    const p = initiate(100000n); p.markCaptured('g', 'card', 't'); p.pullEvents();
    expect(() => p.refund(100001n, 'r')).toThrow(RefundExceedsPaymentError);
    expect(() => p.refund(0n, 'r')).toThrow(RefundExceedsPaymentError);
  });
});
