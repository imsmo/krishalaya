// apps/web-storefront/src/test/order-payment-state.spec.ts · PC-56 HOTFIX-4 · C1/C2 (survey F-1) — REWRITTEN from payments-status.spec.ts,
// which pinned the bug: it classified with a PAYMENT vocabulary ('captured' / 'succeeded' / 'paid' …) and asserted that 'created' was
// "pending" — the very mapping that told a paid (`confirmed`) buyer to pay again and sent every `created` (online payments OFF) order to
// a Pay step that 404s. The storefront now maps only the ORDER's own `paymentState` (the API decides it from the order state machine).
import {
  ORDER_PAYMENT_STATES, paymentStateOf, showsPayStep, payPageRoute, confirmStateKey, CONFIRM_STATE_KEYS, afterPlacementHref, confirmHref, payHref,
} from '../features/orders/payment-state';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

describe('HOTFIX-4 · the order\'s payment state (never a payment vocabulary)', () => {
  it('reads exactly the API vocabulary; anything else is unknown — no string guessing, no case folding', () => {
    for (const s of ORDER_PAYMENT_STATES) expect(paymentStateOf({ paymentState: s })).toBe(s);
    for (const s of ['captured', 'succeeded', 'success', 'settled', 'confirmed', 'created', 'PAID', '', undefined, null, 7]) {
      expect([s, paymentStateOf({ paymentState: s })]).toEqual([s, 'unknown']);
    }
    expect(paymentStateOf(null)).toBe('unknown');
  });
  it('ONLY `pending` has a Pay step — `none` (online payments off) never does, nor paid / closed / unknown', () => {
    expect(ORDER_PAYMENT_STATES.filter((s) => showsPayStep(s))).toEqual(['pending']);
    expect(showsPayStep('unknown')).toBe(false);
    expect(payPageRoute('pending')).toBe('pay');
    for (const s of ['none', 'paid', 'refunded', 'cancelled', 'expired', 'unknown'] as const) expect(payPageRoute(s)).toBe('confirm');
  });
  it('every state has its own confirmation sentence, in en / hi / gu', () => {
    expect(new Set(Object.values(CONFIRM_STATE_KEYS)).size).toBe(ORDER_PAYMENT_STATES.length + 1);
    for (const cat of [en, hi, gu] as Record<string, string>[]) for (const s of [...ORDER_PAYMENT_STATES, 'unknown'] as const) {
      expect([s, typeof cat[confirmStateKey(s)]]).toEqual([s, 'string']);
    }
  });
  it('"paid" says the money is held until the order completes (capture → escrow, released at completion) — never "You were not charged"', () => {
    expect(en[confirmStateKey('paid')]).toMatch(/held/i);
    expect(en[confirmStateKey('none')]).toMatch(/seller confirms/i);
    expect(en[confirmStateKey('none')]).toMatch(/on delivery/i);
    expect(en[confirmStateKey('none')]).not.toMatch(/20,000|cap|limit/i);   // founder D2: no COD cap copy
  });
});

describe('HOTFIX-4 · C2 / A9 after placement — the ORDERS decide; every order of the group is named', () => {
  it('one order awaiting payment → its Pay step', () => {
    expect(afterPlacementHref({ orders: [{ id: 'o1', paymentState: 'pending' }], checkoutGroupId: null })).toBe('/checkout/pay?o=o1');
  });
  it('one order placed with online payments OFF (`none`) → straight to the confirmation, never the payments route', () => {
    expect(afterPlacementHref({ orders: [{ id: 'o1', paymentState: 'none' }], checkoutGroupId: null })).toBe('/checkout/confirm?o=o1');
  });
  it('several orders → the GROUP confirmation (each order listed there, each with its own Pay link when pending)', () => {
    const r = { orders: [{ id: 'o1', paymentState: 'pending' }, { id: 'o2', paymentState: 'pending' }], checkoutGroupId: 'g1' };
    expect(afterPlacementHref(r)).toBe('/checkout/confirm?g=g1');
    expect(afterPlacementHref({ ...r, orders: r.orders.map((o) => ({ ...o, paymentState: 'none' })) }, 'invalid')).toBe('/checkout/confirm?g=g1&cn=invalid');
  });
  it('an unreadable result (no orders) gives no address; links keep the group', () => {
    expect(afterPlacementHref({ orders: [], checkoutGroupId: null })).toBeNull();
    expect(confirmHref('o1', 'g1')).toBe('/checkout/confirm?g=g1');
    expect(confirmHref('o1')).toBe('/checkout/confirm?o=o1');
    expect(payHref('o 1', 'g1')).toBe('/checkout/pay?o=o%201&g=g1');
  });
});
