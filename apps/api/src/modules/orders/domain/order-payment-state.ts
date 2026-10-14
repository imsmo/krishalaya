// modules/orders/domain/order-payment-state.ts · PC-56 HOTFIX-4 · A1 (survey F-1 / B1) — WHAT THE BUYER HAS PAID, SAID BY THE ORDER.
// Pure, no I/O, exhaustive over order.state.ts.
//
// **THE DEFECT THIS ANSWERS.** The storefront classified an ORDER's status with a PAYMENT vocabulary
// (`captured|succeeded|paid|settled|success`). A paid order's status is `confirmed` (Order.markPaid), which is in none of those, so a buyer
// who had paid was told "payment is still being confirmed" and offered Pay again; and with `online_payments` OFF (the seed) every order is
// `created` — no money step at all — and the buyer was sent to a Pay button whose route answers 404 behind its flag.
//
// **THE ORDER SAYS IT NOW, IN ITS OWN TERMS.** Two facts decide it: the status, and whether the order was PLACED awaiting an online payment
// (its first `order_events` row went to `payment_pending` — the `online_payments` flag at placement). `payment_pending → confirmed` is
// reached ONLY through `Order.markPaid` (the payments module's capture, wallet pay included): `Order.confirm` refuses a seller confirm of an
// order still awaiting payment (HOTFIX-4), so "placed awaiting payment and now past it" means paid.
//
//   none       placed with no online payment expected (the flag was OFF): the seller confirms; payment happens on delivery, off-platform
//   pending    awaiting the buyer's online payment (`payment_pending`)
//   paid       an online payment was captured into escrow (confirmed and every later state of an order placed awaiting payment)
//   refunded   `refunded` / `partially_refunded` (a dispute's refund)
//   cancelled  cancelled by a person (buyer, seller) — or a COD order the seller never confirmed
//   expired    the unpaid order's acceptance window ran out and the system cancelled it (`payment_pending → cancelled`, no person acted)
import { ORDER_STATUSES, OrderStatus } from './order.state';

export const ORDER_PAYMENT_STATES = ['none', 'pending', 'paid', 'refunded', 'cancelled', 'expired'] as const;
export type OrderPaymentState = (typeof ORDER_PAYMENT_STATES)[number];

export interface OrderPaymentFacts {
  /** The order was placed awaiting an online payment (its placement event went to `payment_pending`). */
  placedAwaitingPayment: boolean;
  /** For a cancelled order: the status it was cancelled FROM (null when unknown / not cancelled). */
  cancelledFrom: OrderStatus | null;
  /** For a cancelled order: no person acted (the seller-confirm timeout job). */
  cancelledBySystem: boolean;
}

export function orderPaymentState(status: OrderStatus, facts: OrderPaymentFacts): OrderPaymentState {
  switch (status) {
    case 'created': return 'none';
    case 'payment_pending': return 'pending';
    case 'refunded':
    case 'partially_refunded': return 'refunded';
    case 'cancelled':
      return facts.cancelledFrom === 'payment_pending' && facts.cancelledBySystem ? 'expired' : 'cancelled';
    // every state an order reaches AFTER confirmation: paid when it was placed awaiting payment, else pay-on-delivery
    case 'confirmed': case 'packed': case 'ready': case 'picked_up': case 'in_transit': case 'out_for_delivery':
    case 'delivered': case 'completed': case 'disputed': case 'partially_fulfilled':
      return facts.placedAwaitingPayment ? 'paid' : 'none';
    default:
      // exhaustiveness: a status added to the machine without a decision here is a compile-time AND a runtime error
      return assertNever(status);
  }
}

function assertNever(s: never): never { throw new Error(`orderPaymentState: unmapped order status ${String(s)}`); }

/** Every status the machine has is decided (the unit spec walks this list). */
export const DECIDED_STATUSES: readonly OrderStatus[] = ORDER_STATUSES;
